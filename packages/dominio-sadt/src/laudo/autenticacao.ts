// Laudo emitido com código único e QR para a validação pública, sem conteúdo clínico (ficha do M26, regra 11; cap-09
// §9.8). O código é o do legado (UUID de 36 caracteres na impressão; 10.681 impressões de 01 a 07/2026): a mesma
// autenticação vale nos dois sistemas. Reemitir gera a "2ª via" auditada.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O código de autenticação no formato do legado (UUID em minúsculas, 36 caracteres: 10.681 de 10.681). */
export function codigoDeAutenticacao(uuid: string): string {
  const t = uuid.trim();
  if (!UUID.test(t)) throw new Error('Código de autenticação fora do formato.');
  return t.toLowerCase();
}

export function codigoAutenticacaoValido(codigo: string): boolean {
  return UUID.test(codigo.trim());
}

/** O endereço da validação pública impresso no QR (só o código: nenhum dado clínico nem do paciente). */
export function enderecoDeValidacao(base: string, codigo: string): string {
  return `${base.replace(/\/+$/, '')}/resultados/validar/${encodeURIComponent(codigoDeAutenticacao(codigo))}`;
}

/** O texto da via no rodapé do laudo. */
export function rotuloDaVia(segundaVia: boolean, emitidasAntes: number): string {
  if (!segundaVia || emitidasAntes === 0) return '1ª via';
  return `${emitidasAntes + 1}ª via`;
}
