-- Fix lot expiry validation for PostgreSQL POSIX regular expressions.
-- The previous \d shorthand was not recognized as a digit class by PostgreSQL.
DO $$
BEGIN
  IF NOT ('2026-11-25' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'Expiry date format regression: valid ISO date rejected';
  END IF;
  IF ('25-11-2026' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
    RAISE EXCEPTION 'Expiry date format regression: invalid date format accepted';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_items jsonb,
  p_notes text DEFAULT ''::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_order public.purchase_orders%rowtype;
  v_item jsonb;
  v_line public.purchase_order_items%rowtype;
  v_product public.products%rowtype;
  v_quantity numeric(14,3);
  v_receipt_id uuid := gen_random_uuid();
  v_receipt_number text;
  v_count integer := 0;
  v_received_total numeric(14,3) := 0;
  v_remaining numeric(14,3);
  v_lot_code text;
  v_expiry_date date;
  v_lot_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_order
  FROM public.purchase_orders
  WHERE id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF NOT private.has_tenant_permission(v_order.tenant_id, 'purchasing_manage') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF v_order.status NOT IN ('ordered', 'partially_received') THEN
    RAISE EXCEPTION 'Order cannot be received';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_items) < 1
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'Receipt must contain at least one line';
  END IF;

  v_receipt_number := 'REC-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_receipt_id::text, '-', ''), 1, 8));

  INSERT INTO public.purchase_receipts(
    id, tenant_id, purchase_order_id, location_id, receipt_number, received_by, notes
  )
  VALUES (
    v_receipt_id, v_order.tenant_id, v_order.id, v_order.location_id,
    v_receipt_number, auth.uid(), left(coalesce(p_notes, ''), 1000)
  );

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_count := v_count + 1;

    SELECT * INTO v_line
    FROM public.purchase_order_items
    WHERE id = (v_item->>'order_item_id')::uuid
      AND tenant_id = v_order.tenant_id
      AND purchase_order_id = v_order.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order line not found';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_line.product_id
      AND tenant_id = v_order.tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product not found';
    END IF;

    v_quantity := (v_item->>'quantity')::numeric;
    v_remaining := v_line.quantity - v_line.received_quantity;

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity > v_remaining THEN
      RAISE EXCEPTION 'Received quantity exceeds remaining quantity';
    END IF;

    INSERT INTO public.purchase_receipt_items(
      tenant_id, receipt_id, purchase_order_item_id, product_id, quantity, unit_cost
    )
    VALUES (
      v_order.tenant_id, v_receipt_id, v_line.id, v_line.product_id, v_quantity, v_line.unit_cost
    );

    IF v_product.track_lots THEN
      v_lot_code := trim(coalesce(v_item->>'lot_code', ''));

      IF length(v_lot_code) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'Lot number is required for lot-tracked products';
      END IF;

      -- PostgreSQL uses POSIX regular expressions; use an explicit digit class.
      IF coalesce(v_item->>'expiry_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'A valid expiry date is required for lot-tracked products';
      END IF;

      v_expiry_date := (v_item->>'expiry_date')::date;
      IF v_expiry_date < current_date THEN
        RAISE EXCEPTION 'Cannot receive an already expired lot';
      END IF;

      PERFORM pg_advisory_xact_lock(
        hashtextextended(v_order.tenant_id::text || ':' || v_order.location_id::text || ':' || v_line.product_id::text, 0)
      );

      INSERT INTO public.stock_lots(
        tenant_id, product_id, location_id, lot_code, expiry_date, created_by
      )
      VALUES (
        v_order.tenant_id, v_line.product_id, v_order.location_id,
        v_lot_code, v_expiry_date, auth.uid()
      )
      ON CONFLICT (tenant_id, product_id, location_id, lot_code)
      DO UPDATE SET expiry_date = excluded.expiry_date
      WHERE public.stock_lots.expiry_date = excluded.expiry_date
      RETURNING id INTO v_lot_id;

      IF v_lot_id IS NULL THEN
        RAISE EXCEPTION 'Lot code already exists with a different expiry date';
      END IF;

      INSERT INTO public.stock_movements(
        tenant_id, location_id, product_id, lot_id, movement_type,
        quantity_delta, reference, note, created_by
      )
      VALUES (
        v_order.tenant_id, v_order.location_id, v_line.product_id, v_lot_id,
        'receipt', v_quantity, v_order.order_number, 'Réception ' || v_receipt_number, auth.uid()
      );
    ELSE
      IF coalesce(v_item->>'lot_code', '') <> ''
         OR coalesce(v_item->>'expiry_date', '') <> '' THEN
        RAISE EXCEPTION 'Lot fields are only accepted for products with lot tracking enabled';
      END IF;

      INSERT INTO public.stock_movements(
        tenant_id, location_id, product_id, movement_type,
        quantity_delta, reference, note, created_by
      )
      VALUES (
        v_order.tenant_id, v_order.location_id, v_line.product_id, 'receipt',
        v_quantity, v_order.order_number, 'Réception ' || v_receipt_number, auth.uid()
      );
    END IF;

    UPDATE public.purchase_order_items
    SET received_quantity = received_quantity + v_quantity
    WHERE id = v_line.id
      AND tenant_id = v_order.tenant_id;

    v_received_total := v_received_total + v_quantity;
  END LOOP;

  IF v_count = 0 OR v_received_total <= 0 THEN
    RAISE EXCEPTION 'Empty receipt';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.purchase_order_items i
    WHERE i.tenant_id = v_order.tenant_id
      AND i.purchase_order_id = v_order.id
      AND i.received_quantity < i.quantity
  ) THEN
    UPDATE public.purchase_orders
    SET status = 'partially_received', updated_at = now()
    WHERE id = v_order.id AND tenant_id = v_order.tenant_id;
  ELSE
    UPDATE public.purchase_orders
    SET status = 'received', updated_at = now()
    WHERE id = v_order.id AND tenant_id = v_order.tenant_id;
  END IF;

  RETURN v_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_purchase_order(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid, jsonb, text) TO authenticated;
