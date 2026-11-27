// Interface com os equipamentos do laboratório no worker (C3-004, 05-SADT linha 13). A API põe o pedido de cada amostra
// na fila (integracao_mensagem, direção 'saida', ponto sadt.equipamento.pedido, 'pendente'); este adaptador entrega pela
// interface_equipamento conforme o modelo de comunicação e marca a mensagem como 'enviada' (com o recibo) ou soma a
// tentativa (de novo mais tarde; 'erro' depois do teto). O resultado que volta do equipamento entra na fila como mensagem
// de entrada 'pendente' do ponto sadt.equipamento.resultado, marcada como vinda do equipamento e sem duplicar (a chave
// da mensagem do remetente); a API a processa pela mesma regra da digitação (reprocessar, que aceita a pendente).
//
// Central de integrações externas (decisão 53, entrada equipamentos-laboratorio): o modo vem da configuração da
// central (configuracao_integracao_externa), nunca do ambiente. Simulador (padrão e sempre fora de produção, regra 6):
// responde pelo contrato do serviço (aceite com protocolo, recusa com motivo, erro de transporte) de forma
// determinística e devolve um resultado sintético para o hospital treinar. Real (só em produção, com a chave na tela):
//   - ASTM por TCP pelo protocolo de baixo nível E1381 (ENQ, quadros com soma de conferência, ACK/NAK e retransmissão);
//   - HL7 v2 por MLLP (ORM^O01 na ida, ACK na volta; o enviador MLLP comum);
//   - pasta de arquivos (grava o pedido na pasta de envio; o leitor da pasta de retorno recolhe o resultado);
//   - porta serial: depende de uma biblioteca de porta serial no worker (decisão de dependência) e do manual do
//     equipamento: falha com o motivo, sem inventar transporte.
// O recolhimento em produção: leitor da pasta de retorno (modelo arquivo) e ouvinte TCP quando o caminho de retorno da
// interface é "tcp:<porta>" (ASTM E1381 ou HL7 MLLP, pelo protocolo da interface). Log só com ids, códigos e contagens.
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { basename, join } from 'node:path';
import { deMllp, emMllp, lerAck, respostaSimulada } from '@sgh/dominio-integracao';
import {
  type AmostraLida,
  ASTM_CONTROLE,
  ASTM_TENTATIVAS_QUADRO,
  lerAstmResultado,
  lerHl7Resultado,
  lerQuadroAstm,
  montarAstmPedido,
  montarHl7Pedido,
  quadrosAstm,
} from '@sgh/dominio-sadt';
import type { Escritor, Leitor } from '@sgh/nucleo';
import { destinoPermitido, enviarMllp } from '../integracao/enviadores.js';
import type { NucleoRelay } from '../relay-outbox-proprio.js';

export const INTEGRACAO_EQUIPAMENTOS = 'equipamentos-laboratorio';
export const PONTO_PEDIDO_EQUIPAMENTO = 'sadt.equipamento.pedido';
export const PONTO_RESULTADO_EQUIPAMENTO = 'sadt.equipamento.resultado';
const ENTIDADE = 'interface_equipamento';
export const TETO_ENTREGA_EQUIPAMENTO = 50;
/** Tentativas antes de a mensagem ficar em 'erro' (o laboratório reenvia pela tela). */
export const TENTATIVAS_ENTREGA_EQUIPAMENTO = 5;

export class ErroEquipamento extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroEquipamento';
  }
}

export interface InterfaceDestino {
  readonly id: number;
  readonly protocolo: string;
  readonly host: string | null;
  readonly porta: number | null;
  readonly caminhoEnvio: string | null;
}

export interface PedidoNaFila {
  readonly id: number;
  readonly estabelecimento: number;
  readonly interface: InterfaceDestino;
  readonly amostra: string;
  readonly urgente: boolean;
  readonly testes: readonly string[];
  readonly astm: string | null;
}

export interface Entrega {
  readonly recibo: string;
  /** Só o simulador devolve o resultado junto (o real chega pelo ouvinte ou pela pasta). */
  readonly resultado?: readonly AmostraLida[];
}

export type TransporteEquipamento = (p: PedidoNaFila) => Promise<Entrega>;

// ── simulador ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A chave do simulador: o pedido e a amostra (amostra terminada em "-recusa" é recusada; em "-erro", falha). */
export const chaveSimuladorEquipamento = (p: Pick<PedidoNaFila, 'id' | 'amostra'>): string =>
  `${PONTO_PEDIDO_EQUIPAMENTO}:${p.id}:${p.amostra}`;

/** Valor sintético determinístico do teste (o mesmo pedido dá sempre o mesmo resultado). */
export function valorSimulado(amostra: string, teste: string): string {
  let s = 7;
  for (const c of `${amostra}:${teste}`) s = (s * 31 + c.charCodeAt(0)) % 9973;
  return ((s % 900) / 10 + 10).toFixed(1);
}

/** O simulador da central pelo contrato do equipamento: aceite com protocolo e resultado, recusa ou erro de transporte. */
export const transporteSimulado: TransporteEquipamento = (p) => {
  const r = respostaSimulada(INTEGRACAO_EQUIPAMENTOS, chaveSimuladorEquipamento(p));
  if (r.tipo === 'erro-transporte') return Promise.reject(new ErroEquipamento('simulador-sem-resposta'));
  if (r.tipo === 'recusa') return Promise.reject(new ErroEquipamento(`${r.codigo}: ${r.mensagem}`));
  return Promise.resolve({
    recibo: r.protocolo,
    resultado: [
      {
        amostra: p.amostra,
        leituras: p.testes.map((t) => ({ codigo: t, valor: valorSimulado(p.amostra, t) })),
      },
    ],
  });
};

// ── transporte real ─────────────────────────────────────────────────────────────────────────────────────────────

/** Envia a mensagem ASTM por TCP pelo E1381: ENQ, cada quadro esperando ACK (NAK repete até 6 vezes) e EOT. */
export function enviarAstmTcp(
  host: string,
  porta: number,
  mensagem: string,
  tempoMs = 15_000,
): Promise<string> {
  const { ENQ, ACK, NAK, EOT } = ASTM_CONTROLE;
  const quadros = quadrosAstm(mensagem);
  return new Promise((ok, falha) => {
    const s = connect({ host, port: porta });
    let etapa = -1; // -1: esperando a resposta do ENQ; i: esperando a do quadro i
    let repeticoes = 0;
    const fim = (e: Error | null) => {
      clearTimeout(t);
      s.destroy();
      if (e) falha(e);
      else ok(`ASTM-${quadros.length}`);
    };
    const t = setTimeout(() => fim(new ErroEquipamento('tempo esgotado esperando o equipamento')), tempoMs);
    t.unref();
    s.on('connect', () => s.write(ENQ));
    s.on('error', () => fim(new ErroEquipamento('conexao-recusada')));
    s.on('data', (d: Buffer) => {
      const r = d.toString('latin1');
      if (r.includes(ACK)) {
        etapa++;
        repeticoes = 0;
        if (etapa >= quadros.length) {
          s.end(EOT, () => fim(null));
          return;
        }
        s.write(quadros[etapa]!, 'latin1');
      } else if (r.includes(NAK)) {
        if (etapa < 0) return fim(new ErroEquipamento('equipamento ocupado (NAK no ENQ)'));
        if (++repeticoes >= ASTM_TENTATIVAS_QUADRO)
          return fim(new ErroEquipamento('quadro recusado seis vezes'));
        s.write(quadros[etapa]!, 'latin1');
      }
    });
  });
}

const seguro = (t: string) => t.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);

/** O transporte real pelo modelo de comunicação da interface. Fora de produção, só loopback (trava de saídas). */
export function transporteReal(
  ambiente: string,
  quando: () => Date = () => new Date(),
): TransporteEquipamento {
  return async (p) => {
    const i = p.interface;
    const astm = p.astm ?? montarAstmPedido({ amostra: p.amostra, testes: p.testes, urgente: p.urgente });
    const rede = () => {
      if (!i.host || !i.porta) throw new ErroEquipamento('interface sem endereço e porta');
      if (!destinoPermitido(ambiente, i.host))
        throw new ErroEquipamento('destino fora do loopback fora de produção');
      return { host: i.host, porta: i.porta };
    };
    if (i.protocolo === 'astm') {
      const d = rede();
      return { recibo: await enviarAstmTcp(d.host, d.porta, astm) };
    }
    if (i.protocolo === 'hl7') {
      const d = rede();
      const controle = `SGH${p.id}`;
      const ack = lerAck(
        await enviarMllp(
          d.host,
          d.porta,
          montarHl7Pedido({
            amostra: p.amostra,
            testes: p.testes,
            urgente: p.urgente,
            controle,
            quando: quando().toISOString().replace(/\D/g, '').slice(0, 14),
          }),
        ),
      );
      if (ack.codigo !== 'AA' && ack.codigo !== 'CA')
        throw new ErroEquipamento(`${ack.codigo}: ${ack.texto}`);
      return { recibo: `${ack.codigo}-${ack.controle || controle}` };
    }
    if (i.protocolo === 'arquivo') {
      if (!i.caminhoEnvio) throw new ErroEquipamento('interface sem pasta de envio');
      const nome = `${seguro(p.amostra)}-${p.id}.astm`;
      await mkdir(i.caminhoEnvio, { recursive: true });
      await writeFile(join(i.caminhoEnvio, `.${nome}.tmp`), astm, 'latin1');
      await rename(join(i.caminhoEnvio, `.${nome}.tmp`), join(i.caminhoEnvio, nome));
      return { recibo: `ARQ-${nome}` };
    }
    if (i.protocolo === 'serial')
      throw new ErroEquipamento(
        'porta serial depende da biblioteca de porta serial no worker (decisão de dependência)',
      );
    throw new ErroEquipamento(
      'protocolo depende da definição do fornecedor (aviso na central de integrações)',
    );
  };
}

// ── modo pela central ───────────────────────────────────────────────────────────────────────────────────────────

/** O modo efetivo: o real só em produção e com a chave da central ligada; senão, o simulador. */
export async function modoDoEquipamento(l: Leitor, producao: boolean): Promise<'simulador' | 'real'> {
  if (!producao) return 'simulador';
  const c = await l.uma('SELECT modo FROM configuracao_integracao_externa WHERE integracao = ?', [
    INTEGRACAO_EQUIPAMENTOS,
  ]);
  return c && String(c['modo']) === 'real' ? 'real' : 'simulador';
}

// ── fila ────────────────────────────────────────────────────────────────────────────────────────────────────────

function carga(conteudo: unknown): Record<string, unknown> {
  try {
    const v = typeof conteudo === 'string' ? JSON.parse(conteudo) : conteudo;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const textoOuNulo = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

/**
 * Grava o resultado recebido do equipamento como mensagem de entrada 'pendente', marcada com a origem, sem duplicar
 * (a chave da mensagem do remetente por interface). Devolve o id e se é nova.
 */
export async function gravarResultadoRecebido(
  e: Escritor,
  r: {
    readonly estabelecimento: number;
    readonly interfaceId: number;
    readonly chave: string;
    readonly amostras: readonly AmostraLida[];
    readonly agora: Date;
  },
): Promise<{ readonly id: number; readonly nova: boolean }> {
  const chave = r.chave.slice(0, 120);
  const ja = await e.uma(
    `SELECT id FROM integracao_mensagem
      WHERE entidade = '${ENTIDADE}' AND entidade_id = ? AND direcao = 'entrada' AND ponto = ? AND referencia_externa = ?`,
    [r.interfaceId, PONTO_RESULTADO_EQUIPAMENTO, chave],
  );
  if (ja) return { id: Number(ja['id']), nova: false };
  const id = await e.inserir(
    `INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, tentativas, entidade, entidade_id,
       referencia_externa, conteudo, criado_em, versao) VALUES (?, ?, 'entrada', 'pendente', 0, ?, ?, ?, ?, ?, 1)`,
    [
      r.estabelecimento,
      PONTO_RESULTADO_EQUIPAMENTO,
      ENTIDADE,
      r.interfaceId,
      chave,
      JSON.stringify({ origem: 'equipamento', amostras: r.amostras }),
      r.agora,
    ],
  );
  return { id, nova: true };
}

export interface ResultadoEntregaEquipamento {
  readonly lidas: number;
  readonly enviadas: number;
  readonly falhas: number;
  readonly resultados: number;
}

/** Um ciclo de entrega no cliente (`estabelecimento`: só as dele, para os testes isolarem a massa). */
export async function cicloEntregaEquipamento(
  nucleo: NucleoRelay,
  cliente: string,
  transporte: TransporteEquipamento,
  opcoes: { readonly agora?: () => Date; readonly estabelecimento?: number } = {},
): Promise<ResultadoEntregaEquipamento> {
  const agora = opcoes.agora ?? (() => new Date());
  const ctx = { cliente, correlacao: 'entrega-equipamento' };
  const filtro = opcoes.estabelecimento === undefined ? '' : ' AND m.estabelecimento_id = ?';
  const linhas = await nucleo.lerSomente(ctx, (l) =>
    l.consultar(
      `SELECT m.id, m.estabelecimento_id, m.conteudo, m.tentativas, i.id AS interface_id, i.protocolo,
              i.endereco_host, i.porta, i.caminho_envio
         FROM integracao_mensagem m
         JOIN interface_equipamento i ON i.id = m.entidade_id AND i.estabelecimento_id = m.estabelecimento_id
        WHERE m.direcao = 'saida' AND m.ponto = ? AND m.situacao = 'pendente' AND m.entidade = '${ENTIDADE}'
          AND (m.proxima_tentativa_em IS NULL OR m.proxima_tentativa_em <= ?)
          AND i.ativo = TRUE AND i.envia_lista_trabalho = TRUE${filtro}
        ORDER BY m.id LIMIT ${TETO_ENTREGA_EQUIPAMENTO}`,
      [
        PONTO_PEDIDO_EQUIPAMENTO,
        agora(),
        ...(opcoes.estabelecimento === undefined ? [] : [opcoes.estabelecimento]),
      ],
    ),
  );
  let enviadas = 0;
  let falhas = 0;
  let resultados = 0;
  for (const x of linhas) {
    const c = carga(x['conteudo']);
    const testes = Array.isArray(c['testes'])
      ? (c['testes'] as unknown[]).map((t) =>
          t && typeof t === 'object' ? String((t as Record<string, unknown>)['codigo'] ?? '') : String(t),
        )
      : [];
    const p: PedidoNaFila = {
      id: Number(x['id']),
      estabelecimento: Number(x['estabelecimento_id']),
      interface: {
        id: Number(x['interface_id']),
        protocolo: String(x['protocolo']),
        host: textoOuNulo(x['endereco_host']),
        porta: x['porta'] === null || x['porta'] === undefined ? null : Number(x['porta']),
        caminhoEnvio: textoOuNulo(x['caminho_envio']),
      },
      amostra: String(c['amostra'] ?? ''),
      urgente: c['urgente'] === true,
      testes: testes.filter((t) => t !== ''),
      astm: typeof c['astm'] === 'string' ? c['astm'] : null,
    };
    let entrega: Entrega | null = null;
    let erro = '';
    try {
      entrega = await transporte(p);
    } catch (e) {
      erro = (
        e instanceof ErroEquipamento ? e.message : `transporte-falhou:${e instanceof Error ? e.name : 'erro'}`
      ).slice(0, 200);
    }
    const t = agora();
    const tentativas = Number(x['tentativas'] ?? 0) + 1;
    await nucleo.escrever(ctx, async (w) => {
      if (entrega) {
        const n = await w.executar(
          `UPDATE integracao_mensagem SET situacao = 'enviada', resposta = ?, erro = NULL, tentativas = ?,
                  processada_em = ?, proxima_tentativa_em = NULL, alterado_em = ?, versao = versao + 1
            WHERE id = ? AND situacao = 'pendente'`,
          [JSON.stringify({ recibo: entrega.recibo.slice(0, 120) }), tentativas, t, t, p.id],
        );
        if (n > 0 && entrega.resultado?.length) {
          const g = await gravarResultadoRecebido(w, {
            estabelecimento: p.estabelecimento,
            interfaceId: p.interface.id,
            chave: `SIM-${p.id}`,
            amostras: entrega.resultado,
            agora: t,
          });
          if (g.nova) resultados++;
        }
        return;
      }
      const esgotou = tentativas >= TENTATIVAS_ENTREGA_EQUIPAMENTO;
      await w.executar(
        `UPDATE integracao_mensagem SET situacao = ?, erro = ?, tentativas = ?, proxima_tentativa_em = ?,
                alterado_em = ?, versao = versao + 1
          WHERE id = ? AND situacao = 'pendente'`,
        [
          esgotou ? 'erro' : 'pendente',
          erro,
          tentativas,
          esgotou ? null : new Date(t.getTime() + 60_000 * 2 ** (tentativas - 1)),
          t,
          p.id,
        ],
      );
    });
    if (entrega) enviadas++;
    else falhas++;
  }
  return { lidas: linhas.length, enviadas, falhas, resultados };
}

// ── recolhimento do resultado ───────────────────────────────────────────────────────────────────────────────────

/** Lê o resultado pelo formato: HL7 v2 quando começa pelo MSH; senão, ASTM. */
export function lerResultadoEquipamento(conteudo: string): {
  readonly controle: string | null;
  readonly amostras: readonly AmostraLida[];
} {
  const limpo = conteudo.replace(/^[^A-Za-z]*/, '');
  if (limpo.startsWith('MSH')) {
    const r = lerHl7Resultado(limpo);
    return { controle: r.controle || null, amostras: r.amostras };
  }
  return { controle: null, amostras: lerAstmResultado(conteudo).amostras };
}

/**
 * Leitor da pasta de retorno: cada arquivo vira um resultado com a chave do nome do arquivo; o chamador grava e move o
 * arquivo para a pasta de processados (ou de erro, quando não traz leitura).
 */
export async function lerPastaRetorno(
  pasta: string,
): Promise<
  { readonly arquivo: string; readonly chave: string; readonly amostras: readonly AmostraLida[] }[]
> {
  const nomes = (await readdir(pasta, { withFileTypes: true }))
    .filter((d) => d.isFile() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
  const saida = [];
  for (const nome of nomes) {
    const r = lerResultadoEquipamento(await readFile(join(pasta, nome), 'latin1'));
    saida.push({ arquivo: join(pasta, nome), chave: `ARQ-${basename(nome)}`, amostras: r.amostras });
  }
  return saida;
}

/** Move o arquivo lido para a pasta de destino (processados ou erro). */
export async function moverArquivo(arquivo: string, pasta: string): Promise<void> {
  await mkdir(pasta, { recursive: true });
  await rename(arquivo, join(pasta, basename(arquivo)));
}

export type AoReceberResultado = (r: {
  readonly chave: string;
  readonly amostras: readonly AmostraLida[];
}) => Promise<void>;

let sequenciaRecebida = 0;
const chaveRecebida = (prefixo: string) => `${prefixo}-${Date.now()}-${++sequenciaRecebida}`;

/**
 * Receptor E1381 numa conexão: responde ACK ao ENQ e a cada quadro com soma certa (NAK no quadro errado), junta os
 * registros e, no EOT, entrega a mensagem montada.
 */
export function receptorAstm(s: Socket, aoReceber: AoReceberResultado): void {
  const { ENQ, ACK, NAK, EOT, STX } = ASTM_CONTROLE;
  let buf = '';
  let texto = '';
  s.on('data', (d: Buffer) => {
    buf += d.toString('latin1');
    for (;;) {
      if (buf.startsWith(ENQ)) {
        texto = '';
        buf = buf.slice(1);
        s.write(ACK);
        continue;
      }
      if (buf.startsWith(EOT)) {
        buf = buf.slice(1);
        const msg = texto;
        texto = '';
        if (msg) void aoReceber({ chave: chaveRecebida('ASTM'), amostras: lerAstmResultado(msg).amostras });
        continue;
      }
      if (buf.startsWith(STX)) {
        const fim = buf.indexOf('\n');
        if (fim < 0) break;
        const q = lerQuadroAstm(buf.slice(0, fim + 1));
        buf = buf.slice(fim + 1);
        if (q.valido) texto += q.texto;
        s.write(q.valido ? ACK : NAK);
        continue;
      }
      if (buf.length === 0) break;
      buf = buf.slice(1); // descarta o que não é do protocolo
    }
  });
}

/** Receptor HL7 por MLLP numa conexão: cada ORU^R01 recebe o ACK (AA) e é entregue com a chave do controle (MSH-10). */
export function receptorMllp(s: Socket, aoReceber: AoReceberResultado): void {
  let buf: Uint8Array = new Uint8Array(0);
  s.on('data', (d: Buffer) => {
    const junto = new Uint8Array(buf.length + d.length);
    junto.set(buf);
    junto.set(d, buf.length);
    const r = deMllp(junto);
    buf = r.resto;
    for (const m of r.mensagens) {
      const lido = lerResultadoEquipamento(m);
      const controle = lido.controle ?? chaveRecebida('HL7');
      s.write(
        emMllp(`MSH|^~\\&|SGH|LAB|EQUIPAMENTO|LAB|||ACK^R01^ACK|${controle}|P|2.5.1\rMSA|AA|${controle}\r`),
      );
      void aoReceber({ chave: `HL7-${controle}`, amostras: lido.amostras });
    }
  });
}

/** O ouvinte TCP do resultado (ASTM E1381 ou HL7 MLLP, pelo protocolo da interface). */
export function ouvinteEquipamento(protocolo: string, aoReceber: AoReceberResultado): Server {
  return createServer((s) => {
    s.on('error', () => s.destroy());
    if (protocolo === 'hl7') receptorMllp(s, aoReceber);
    else receptorAstm(s, aoReceber);
  });
}

/** A porta do ouvinte quando o caminho de retorno da interface é "tcp:<porta>". */
export function portaDoOuvinte(caminhoRetorno: string | null): number | null {
  const m = /^tcp:(\d{1,5})$/.exec((caminhoRetorno ?? '').trim());
  const p = m ? Number(m[1]) : NaN;
  return p > 0 && p < 65536 ? p : null;
}
