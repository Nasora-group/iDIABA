import OfflinePOSClient from "./offline-pos-client";

export const metadata = {
  title: "Caisse hors connexion | iDIABA",
  description: "Continuez les ventes enregistrées localement et synchronisez-les au retour du réseau.",
};

export default function OfflinePage() {
  return <OfflinePOSClient />;
}
