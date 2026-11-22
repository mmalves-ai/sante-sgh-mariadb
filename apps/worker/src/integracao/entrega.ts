// Entrega das mensagens às integrações (M34; ficha, regras 8 a 10; cap-12 §12.3): a cada ciclo, por estabelecimento,
// as mensagens prontas (por parceiro e objeto, só a primeira não entregue, e só quando chegou a hora: a ordem por
// objeto não se quebra; a morta segura o objeto até ser tratada) vão ao parceiro pelo enviador do tipo dele. Cada
// parceiro roda em paralelo com o seu tempo máximo: parceiro lento não atrasa os outros. Falhou: a retentativa
// crescente (1 min, 5 min, 30 min, 2 h) até o limite do parceiro; esgotou, a fila de mortos com a falha tratável. O
// conteúdo vai ao armazém de objetos (o resumo SHA-256 no banco); nunca ao log.
// Melhoria: cada marca (reserva, enviada, retentativa, morta) é uma operação do Executor. A mensagem é reservada pela
// versão lida na fila antes de ir ao parceiro (situação "enviando"), e a marca confere a versão da reserva: a mensagem
// que outro processo pegou, ou que a tela descartou ou reprocessou, não é enviada nem sobrescrita (conta em conflitos).
import { createHash } from 'node:crypto';
import { depoisDaFalha, prontasParaEnviar } from '@sgh/dominio-integracao';
import { ErroOperacao } from '@sgh/nucleo';
import type { AcessoIntegracao } from './acesso.js';
import {
  type EnvioEntrega,
  filaDeEnvio,
  lerParceiros,
  marcarEnviado,
  marcarFalhaEnvio,
  type ParceiroEntrega,
  reservarEnvio,
} from './porta-propria.js';

export interface Entregue {
  readonly recibo: string | null;
  readonly resposta: string | null;
  /** O conteúdo enviado (vai ao armazém pelo resumo; só o resumo fica no banco). */
  readonly conteudo: string;
}

/** O enviador de um parceiro: monta o conteúdo do evento e entrega; lança com a resposta curta na falha. */
export type Enviador = (p: ParceiroEntrega, e: EnvioEntrega, hospital: string) => Promise<Entregue>;

export class ErroEntrega extends Error {
  override readonly name = 'ErroEntrega';
  readonly conteudo: string | null;
  constructor(resposta: string, conteudo: string | null = null) {
    super(resposta);
    this.conteudo = conteudo;
  }
}

export interface ResultadoEntrega {
  readonly prontas: number;
  readonly enviadas: number;
  readonly falhas: number;
  readonly mortas: number;
  /** Mensagens que outro processo reservou, ou que mudaram desde a leitura da fila (nada enviado ou sobrescrito). */
  readonly conflitos: number;
}

const resumo = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const conflito = (x: unknown) => x instanceof ErroOperacao && x.problema.codigo === 'conflito-versao';

export async function cicloEntrega(
  acesso: AcessoIntegracao,
  hospital: string,
  enviador: Enviador,
  opcoes: {
    readonly agora: () => Date;
    readonly tempoPorParceiroMs: number;
    /** Guarda o conteúdo no armazém de objetos pelo estabelecimento, o parceiro e o resumo. */
    readonly guardar?: (
      hospital: string,
      parceiro: string,
      resumo: string,
      conteudo: string,
    ) => Promise<unknown>;
  },
): Promise<ResultadoEntrega> {
  const [fila, parceiros] = await acesso.ler(
    hospital,
    async (l) => [await filaDeEnvio(l, hospital), await lerParceiros(l)] as const,
  );
  const porCodigo = new Map(parceiros.map((p) => [p.codigo, p]));
  const prontas = prontasParaEnviar(
    fila.map((e) => ({
      id: e.id,
      parceiro: e.parceiro,
      chaveOrdem: e.chaveOrdem,
      situacao: e.situacao,
      ordem: Number(e.id),
      proximaTentativaEm: e.proximaTentativaEm,
    })),
    opcoes.agora(),
  );
  const porParceiro = new Map<string, EnvioEntrega[]>();
  const porId = new Map(fila.map((e) => [e.id, e]));
  for (const p of prontas) {
    const p0 = porCodigo.get(p.parceiro);
    if (!p0?.ativo) continue; // parceiro desativado: a mensagem espera (nada se perde)
    const l = porParceiro.get(p.parceiro) ?? [];
    l.push(porId.get(p.id)!);
    porParceiro.set(p.parceiro, l);
  }
  let enviadas = 0;
  let falhas = 0;
  let mortas = 0;
  let conflitos = 0;
  await Promise.allSettled(
    [...porParceiro.entries()].map(async ([codigo, envios]) => {
      const parceiro = porCodigo.get(codigo)!;
      const fim = Date.now() + opcoes.tempoPorParceiroMs;
      for (const e of envios) {
        if (Date.now() > fim) break; // o resto deste parceiro fica para o próximo ciclo
        const reserva = await acesso
          .gravar(hospital, (tx) => reservarEnvio(tx, e.id, e.versao, new Date()), {
            operacao: 'integracao.entrega-reservada',
          })
          .catch((x: unknown) => {
            if (conflito(x)) return null;
            throw x;
          });
        if (reserva === null) {
          conflitos++; // outro processo pegou a mensagem, ou a tela a mudou: nada é enviado
          continue;
        }
        let entregue: Entregue | null = null;
        let erro: unknown = null;
        try {
          entregue = await Promise.race([
            enviador(parceiro, e, hospital),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new ErroEntrega('tempo esgotado')), Math.max(1, fim - Date.now())).unref(),
            ),
          ]);
        } catch (x) {
          erro = x;
        }
        try {
          if (entregue) {
            const r = entregue;
            const h = resumo(r.conteudo);
            await opcoes.guardar?.(hospital, codigo, h, r.conteudo).catch(() => null);
            await acesso.gravar(
              hospital,
              (tx) => marcarEnviado(tx, e.id, reserva, { recibo: r.recibo, resposta: r.resposta, hash: h }),
              { operacao: 'integracao.entrega-enviada' },
            );
            enviadas++;
          } else {
            const d = depoisDaFalha(e.tentativas, parceiro.limiteTentativas, opcoes.agora());
            const conteudo = erro instanceof ErroEntrega ? erro.conteudo : null;
            const texto =
              erro instanceof Error
                ? `${erro.name === 'ErroEntrega' ? '' : `${erro.name}: `}${erro.message}`
                : 'falha';
            await acesso.gravar(
              hospital,
              (tx) =>
                marcarFalhaEnvio(tx, e.id, reserva, {
                  ...d,
                  resposta: texto,
                  hash: conteudo ? resumo(conteudo) : null,
                }),
              { operacao: 'integracao.entrega-falha' },
            );
            falhas++;
            if (d.situacao === 'morto') mortas++;
          }
        } catch (x) {
          if (!conflito(x)) throw x;
          conflitos++; // a mensagem mudou durante o envio (descarte ou reprocesso pela tela): a marca não sobrescreve
        }
      }
    }),
  );
  return { prontas: prontas.length, enviadas, falhas, mortas, conflitos };
}
