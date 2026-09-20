// test-manual.ts
import { askSoza } from './lib/ai/client.ts';

console.log('Appel askSoza direct...');
try {
  const result = await askSoza('Ajoute une idée : refaire le rig du perso, taille moyenne');
  console.log('Résultat:', result);
} catch (error) {
  console.error('ERREUR:', error);
}