/** Panneau du volet latéral, ouvert depuis la barre d'activité. */
export interface PanelDef {
  id: string;
  icon: string;
  /** Libellé court (barre d'activité, info-bulle). */
  label: string;
  title: string;
  subtitle: string;
  body: HTMLElement;
  /** Actions de l'en-tête du volet (ex. réinitialiser). */
  actions?: HTMLElement[];
  /** Pied collant (ex. bouton « Générer le tas »). */
  footer?: HTMLElement;
  /** Nombre de réglages modifiés, signalé par une pastille sur l'icône. */
  modified?: () => number;
}
