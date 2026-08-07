// Nombres para los bots de Sit&Go/Torneo (Práctica y Train no los usan).
//
// El fichero de referencia que se pidió mirar
// (E:\Cursos\Projects\PokerTraining\src\lib\names.ts) resultó ser una lista de
// ~150 "nicks" de sala de póker (AceHunter99, RiverRat88...), no nombres de
// pila reales — no encaja con lo pedido ("Javier", "Peter", "Marta"...), así
// que en vez de adaptarlo se escribió esta lista nueva de nombres de pila
// (mezcla es/en/internacional, sin apellidos ni sufijos numéricos).
export const BOT_FIRST_NAMES = [
  "Javier", "Peter", "Marta", "Lucas", "Sofía", "Daniel", "Elena", "Marcos",
  "Laura", "Pablo", "Carmen", "Diego", "Alba", "Álvaro", "Nuria", "Hugo",
  "Paula", "Adrián", "Irene", "Rubén", "Claudia", "Sergio", "Beatriz", "Iván",
  "Cristina", "Mario", "Andrea", "Raúl", "Patricia", "Óscar", "Silvia", "Jorge",
  "John", "Emma", "James", "Olivia", "William", "Ava", "Michael", "Isabella",
  "David", "Sophie", "Thomas", "Grace", "Henry", "Chloe", "George", "Amelia",
  "Robert", "Charlotte", "Anna", "Stefan", "Ingrid", "Lukas", "Freya", "Erik",
  "Greta", "Nils", "Sven", "Astrid", "Marco", "Giulia", "Luca", "Chiara",
  "Matteo", "Francesca", "Pierre", "Camille", "Julien", "Manon", "Louis", "Léa",
  "Hans", "Petra", "Klaus", "Heidi", "Dimitri", "Katarina", "Ivan", "Olga",
  "Yuki", "Haruto", "Mei", "Kenji", "Wei", "Xin", "Amara", "Kwame",
  "Fatima", "Omar", "Leila", "Karim", "Priya", "Arjun", "Ananya", "Rohan",
];

/** Devuelve `count` nombres únicos al azar (sin repetir dentro de la misma
 * partida). Si `count` supera el tamaño de la lista, rellena con "JugadorN". */
export function pickRandomNames(count) {
  const shuffled = [...BOT_FIRST_NAMES].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  for (let i = picked.length; i < count; i++) {
    picked.push(`Jugador${i + 1}`);
  }
  return picked;
}
