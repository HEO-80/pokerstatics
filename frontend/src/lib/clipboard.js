/** Copia texto plano al portapapeles. Devuelve `true`/`false` según el
 * resultado (nunca lanza) para que el caller decida si mostrar feedback. */
export async function copyText(text) {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
