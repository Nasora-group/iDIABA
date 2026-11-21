import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Report = {
  revenue: number; sales_count: number; average_ticket: number;
  costed_revenue: number; cost_of_goods_sold: number; gross_margin: number;
  gross_margin_rate: number; costed_lines: number; uncosted_lines: number;
  recent_sales: { id: string; total: number; completed_at: string }[];
  top_products: {
    product_name: string; quantity: number; revenue: number; cost: number | null;
    gross_margin: number | null; costed_lines: number; total_lines: number;
  }[];
  expenses: number; purchases: number; returns_amount: number; returns_count: number;
  cash_variance: number; stock_movements_count: number;
};

function csv(value: unknown) {
  const text = String(value ?? "");
  return '"' + text.replaceAll('"','""') + '"';
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Non autorisé",{status:401});

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant_id") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return new Response("Paramètres invalides",{status:400});
  }

  const { data: membership } = await supabase.from("tenant_memberships")
    .select("role").eq("tenant_id",tenantId).eq("user_id",user.id).maybeSingle();
  if (!membership || !["owner","admin"].includes(membership.role)) return new Response("Accès refusé",{status:403});

  const start = new Date(from + "T00:00:00.000Z");
  const end = new Date(to + "T00:00:00.000Z");
  end.setUTCDate(end.getUTCDate()+1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end<=start || end.getTime()-start.getTime()>366*24*60*60*1000) {
    return new Response("Période invalide",{status:400});
  }

  const { data, error } = await supabase.rpc("get_tenant_management_report",{
    p_tenant_id:tenantId,p_from:start.toISOString(),p_to:end.toISOString()
  });
  if (error || !data) return new Response("Rapport indisponible",{status:400});
  const report = data as unknown as Report;
  const rows: unknown[][] = [
    ["Indicateur","Valeur"],
    ["Chiffre d'affaires FCFA",report.revenue],
    ["Nombre de ventes",report.sales_count],
    ["Panier moyen FCFA",report.average_ticket],
    ["Chiffre d'affaires HT avec coût connu FCFA",report.costed_revenue],
    ["Coût des marchandises vendues FCFA",report.cost_of_goods_sold],
    ["Marge brute connue FCFA",report.gross_margin],
    ["Taux de marge brute sur ventes valorisées (%)",report.gross_margin_rate],
    ["Lignes valorisées",report.costed_lines],
    ["Lignes sans coût connu",report.uncosted_lines],
    ["Dépenses FCFA",report.expenses],
    ["Commandes fournisseurs FCFA",report.purchases],
    ["Remboursements FCFA",report.returns_amount],
    ["Nombre de retours",report.returns_count],
    ["Écart de caisse FCFA",report.cash_variance],
    ["Mouvements de stock",report.stock_movements_count],
    [],
    ["Top produits","Quantité","Chiffre d'affaires HT FCFA","Coût connu FCFA","Marge brute connue FCFA","Lignes valorisées","Lignes totales"],
    ...(report.top_products ?? []).map((item) => [item.product_name,item.quantity,item.revenue,item.cost ?? "Non disponible",item.gross_margin ?? "Non disponible",item.costed_lines,item.total_lines]),
    [],
    ["Dernières ventes","Date","Montant FCFA"],
    ...(report.recent_sales ?? []).map((item) => [item.id,item.completed_at,item.total]),
  ];
  const body = "\uFEFF" + rows.map((row) => row.map(csv).join(";")).join("\r\n");
  return new Response(body,{
    headers:{
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":'attachment; filename="idiaba-rapport-'+from+'-'+to+'.csv"',
      "Cache-Control":"no-store",
    },
  });
}
