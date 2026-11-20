// Chaves de idempotência das integrações novas (M34; ficha, regras 8 e 11; cap-12 §12.3, Idempotência): o evento de um
// fato que o legado grava é identificado pelo fato, pelo estabelecimento, pelo ID da linha e pelo carimbo da última
// atualização (a mesma versão do fato nunca gera dois eventos, mesmo relida); o consumidor é idempotente pelo
// identificador do evento da outbox e pelo estabelecimento (a mesma entrega não cria outra mensagem ao parceiro); a
// entrada, pela chave do parceiro (MSH-10, lote, ID do recurso).

const PARTE = /^[a-z0-9.-]{1,40}$/i;

function conferir(nome: string, v: string): string {
  if (!PARTE.test(v)) throw new Error(`${nome} fora do formato da chave.`);
  return v;
}

/** Carimbo "AAAA-MM-DD HH:MM:SS.mmm" em partes sem separador (o relógio do banco, sem fuso). */
function carimbo(d: Date | null): string {
  if (!d) return 'sem-carimbo';
  return d
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 17);
}

/** Chave do evento de um fato do legado na SGH_OUTBOX (até 120 caracteres; única). */
export function chaveEventoFato(
  fato: string,
  hospital: string,
  id: string | number,
  versao: Date | null,
): string {
  const k = `fato:${conferir('Fato', fato)}:${conferir('Estabelecimento', hospital)}:${conferir('ID', String(id))}:${carimbo(versao)}`;
  if (k.length > 120) throw new Error('Chave do evento acima de 120 caracteres.');
  return k;
}

/** Identidade de uma entrega do consumidor: o evento da outbox, o estabelecimento e o parceiro. */
export function chaveEntrega(hospital: string, chaveEvento: string, parceiro: string): string {
  return `${conferir('Estabelecimento', hospital)}|${chaveEvento}|${conferir('Parceiro', parceiro)}`;
}

/** Chave do objeto para a ordem (o mesmo paciente ou a mesma conta saem em ordem). */
export function chaveDeOrdem(
  tipo: 'paciente' | 'conta' | 'exame' | 'estabelecimento',
  id: string | number,
): string {
  return `${tipo}:${conferir('ID', String(id))}`;
}

/**
 * Releitura com sobreposição: a marca d'água recua uma janela (o carimbo do legado tem precisão de segundo e duas
 * linhas podem dividir o mesmo instante); as já vistas são descartadas pela chave do evento.
 */
export function inicioDaReleitura(ultimoCarimbo: Date | null, sobreposicaoS = 5): Date | null {
  return ultimoCarimbo ? new Date(ultimoCarimbo.getTime() - sobreposicaoS * 1000) : null;
}
