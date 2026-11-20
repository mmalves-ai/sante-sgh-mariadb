// Entrega das mensagens às integrações novas (M34; ficha, regras 8 a 10; cap-12 §12.3): a cada ciclo, por
// estabelecimento, as mensagens prontas (por parceiro e objeto, só a primeira não entregue, e só quando chegou a hora:
// a ordem por objeto não se quebra; a morta segura o objeto até ser tratada) vão ao parceiro pelo enviador do tipo
// dele. Cada parceiro roda em paralelo com o seu tempo máximo: parceiro lento não atrasa os outros. Falhou: a
// retentativa crescente (1 min, 5 min, 30 min, 2 h) até o limite do parceiro; esgotou, a fila de mortos. O conteúdo
// vai ao S3 (o resumo SHA-256 no banco); nunca ao log.
import { createHash } from 'node:crypto';
import { depoisDaFalha, prontasParaEnviar } from '@sgh/dominio-integracao';
import {
  type EnvioLidoBanco,
  filaDeEnvio,
  lerParceiros,
  marcarEnviado,
  marcarFalhaEnvio,
  type ParceiroLidoBanco,
} from '@sgh/legado';
import type { AcessoIntegracao } from './acesso.js';

export interface Entregue {
  readonly recibo: string | null;
  readonly resposta: string | null;
  /** O conteúdo enviado (vai ao armazém pela chave; só o resumo fica no banco). */
  readonly conteudo: string;
}

/** O enviador de um parceiro: monta o conteúdo do evento e entrega; lança com a resposta curta na falha. */
export type Enviador = (p: ParceiroLidoBanco, e: EnvioLidoBanco, hospital: string) => Promise<Entregue>;

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
}

const resumo = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

export async function cicloEntrega(
  acesso: AcessoIntegracao,
  hospital: string,
  enviador: Enviador,
  opcoes: {
    readonly agora: () => Date;
    readonly tempoPorParceiroMs: number;
    readonly guardar?: (
      hospital: string,
      parceiro: string,
      resumo: string,
      conteudo: string,
    ) => Promise<string | null>;
  },
): Promise<ResultadoEntrega> {
  const [fila, parceiros] = await acesso.ler(
    hospital,
    async (l) => [await filaDeEnvio(l, hospital), await lerParceiros(l, hospital)] as const,
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
  const porParceiro = new Map<string, EnvioLidoBanco[]>();
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
  await Promise.allSettled(
    [...porParceiro.entries()].map(async ([codigo, envios]) => {
      const parceiro = porCodigo.get(codigo)!;
      const fim = Date.now() + opcoes.tempoPorParceiroMs;
      for (const e of envios) {
        if (Date.now() > fim) break; // o resto deste parceiro fica para o próximo ciclo
        try {
          const r = await Promise.race([
            enviador(parceiro, e, hospital),
            new Promise<never>((_, rej) =>
              setTimeout(() => rej(new ErroEntrega('tempo esgotado')), Math.max(1, fim - Date.now())).unref(),
            ),
          ]);
          const h = resumo(r.conteudo);
          const chaveS3 = (await opcoes.guardar?.(hospital, codigo, h, r.conteudo).catch(() => null)) ?? null;
          await acesso.gravar(hospital, (w) =>
            marcarEnviado(w, hospital, e.id, { recibo: r.recibo, resposta: r.resposta, hash: h, chaveS3 }),
          );
          enviadas++;
        } catch (x) {
          falhas++;
          const d = depoisDaFalha(e.tentativas, parceiro.limiteTentativas, opcoes.agora());
          const conteudo = x instanceof ErroEntrega ? x.conteudo : null;
          const texto =
            x instanceof Error ? `${x.name === 'ErroEntrega' ? '' : `${x.name}: `}${x.message}` : 'falha';
          await acesso.gravar(hospital, (w) =>
            marcarFalhaEnvio(
              w,
              hospital,
              e.id,
              d.situacao === 'pendente'
                ? { ...d, resposta: texto, hash: conteudo ? resumo(conteudo) : null }
                : { ...d, resposta: texto, hash: conteudo ? resumo(conteudo) : null },
            ),
          );
          if (d.situacao === 'morto') mortas++;
        }
      }
    }),
  );
  return { prontas: prontas.length, enviadas, falhas, mortas };
}
