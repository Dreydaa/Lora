// Profil angulaire des rayons de la photo de référence (docs/product/soza-fond-eclat-325x238.jpg),
// extrait automatiquement : luminosité du ton le long de chaque rayon issu du centre de l'éclat
// (162, 124 sur 325x238), corrigée de l'assombrissement du cœur par moindres carrés, 360 valeurs
// (1° chacune, sens trigonométrique depuis l'axe +X, 0..255). Les fins rayons de la photo y sont conservés.
export const BURST_PROFILE_SIZE = 360;

const BURST_PROFILE_B64 =
  "3tLArqOdmJaWl5aXmJeTjYV5aFlTUE5KRj85NTMxLywsLSwpJSEcFhIPDQsKCQgHBwYGBgYGBgYGBwcICAkJCgsMDg8QERQXHCAl" +
  "KS0zOT1BQ0NCRU1ZZWxxdHZ7h5CVl5mepKmvs7e9ydfj6/D0+Pz////////////////////9+/n28u/s5+Th397c2dXPyL6unJGP" +
  "k5eXk5GVmpuZlpCGem5jXltWT0lFQDs5Oj1CRUdKTlJYX2JhXFRJPzQqHxcVFx0kKzM5PT49ODIqIhoTDw8ODAkHBAMCAQEBAQEB" +
  "AQEBAQEBAQICAgICAgIDAwMDAwMDAwMDAwICAgICAQEBAQEBAQEBAQEBAQEBAQEBAQECAgIDAwMEBAQEBAQEBQUFBQUFBQUFBQUG" +
  "BgYHBwcHBwcHBwcHCAcHCAgICAgICQkJCQoLDA0PERIVGBwkLjhASVZsh5+wvMPHzdPZ3uLm6Onp6Obk";

export const burstProfile = () => Uint8Array.from(atob(BURST_PROFILE_B64), (c) => c.charCodeAt(0));
