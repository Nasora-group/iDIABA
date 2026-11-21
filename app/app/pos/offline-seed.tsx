"use client";

import { useEffect } from "react";
import { saveOfflineSnapshot, type OfflineProduct } from "./offline-store";

type Props = {
  userId: string;
  tenantId: string;
  tenantName: string;
  locationId: string;
  locationName: string;
  sessionId: string;
  products: OfflineProduct[];
};

export default function OfflinePOSSeed(props: Props) {
  useEffect(() => {
    if (!navigator.onLine) return;
    saveOfflineSnapshot({
      key: [props.userId, props.tenantId, props.locationId, props.sessionId].join(":"),
      userId: props.userId,
      tenantId: props.tenantId,
      tenantName: props.tenantName,
      locationId: props.locationId,
      locationName: props.locationName,
      sessionId: props.sessionId,
      products: props.products,
      savedAt: Date.now(),
    }).catch(() => {
      // Offline mode remains optional when browser storage is unavailable or full.
    });
  }, [props]);
  return null;
}
