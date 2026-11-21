/** Client-safe constants shared by server and client components. */
export const ROLE_LABELS: Record<string, string> = {
  owner: "Propriétaire",
  admin: "Administrateur",
  manager: "Gérant",
  cashier: "Caissier",
  stock: "Magasinier",
  accountant: "Comptable",
  viewer: "Lecture seule",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Contrôle total, y compris l'équipe et l'abonnement.",
  admin: "Gère l'équipe (sauf propriétaires et administrateurs), l'abonnement, l'audit et les rapports.",
  manager: "Pilote l'activité courante.",
  cashier: "Encaisse les ventes en caisse.",
  stock: "Gère les stocks, achats et inventaires.",
  accountant: "Accède à la comptabilité.",
  viewer: "Consultation uniquement.",
};

export const ASSIGNABLE_ROLES = ["owner", "admin", "manager", "cashier", "stock", "accountant", "viewer"] as const;
