// Partida comum dos testes de integração do SADT na API (M26) sobre a cópia compartilhada: só com a trava da cópia
// (o flock da copia.lock que envolve o comando), AMBIENTE=dev e loopback; toda gravação em transação DESFEITA
// (ROLLBACK). O estado de partida (exame lançado, digitado, liberado) pelo próprio executor, com os profissionais, os
// atendimentos e os exames da cópia (só IDs e o login, em memória; nunca impressos). Saída só com contagens.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  type ContextoOperacao,
  type Escritor,
  type Executor,
  fonteCatalogoArquivo,
  lerCodigos,
  lerConfiguracaoNucleo,
  lerExameSadt,
  NucleoLegado,
  operacao,
  travaDaCopiaSegura,
  condicaoLoginDoProfissional,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { portaSadtNaTransacao } from '../porta-legado.js';
import type { PortaSadt } from '../porta.js';

const raiz = resolve(import.meta.dirname, '../../../../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
export const codigos = lerCodigos(env);
/** A trava da cópia é deste processo (ou de um ancestral): sem ela, nenhuma gravação na cópia. */
export const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);

export interface AmbienteSadt {
  readonly nucleo: NucleoLegado;
  readonly executor: Executor;
  readonly cod: string;
}

export async function ambienteSadt(): Promise<AmbienteSadt> {
  const nucleo = new NucleoLegado({
    env: { ...env, FB_POOL_TETO: '3' },
    driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
    pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
  });
  const cod = codigos[0] as string;
  await nucleo.verificarSchema(cod);
  return {
    nucleo,
    executor: nucleo.criarExecutor({
      catalogo: fonteCatalogoArquivo(resolve(raiz, 'docs/operacoes/catalogo')),
    }),
    cod,
  };
}

let seq = 0;
export function contexto(a: AmbienteSadt, usuario: string): ContextoOperacao {
  return {
    rede: a.nucleo.rede,
    hospital: a.cod,
    traceId: 'int-m26-api',
    usuarioLegado: usuario,
    idempotencyKey: `int-m26-${Date.now().toString(36)}-${(seq++).toString(36)}`,
    reautenticadoEm: Date.now(),
  };
}

const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

export interface Profissional {
  readonly login: string;
  readonly vinculo: number;
}

/** O laboratório em transação desfeita: a porta sobre a transação e o estado de partida pelo executor. */
export class MassaSadt {
  readonly porta: PortaSadt;
  readonly c: { rede: string; hospital: string };
  constructor(
    readonly a: AmbienteSadt,
    readonly e: Escritor,
  ) {
    this.porta = portaSadtNaTransacao(e, a.executor);
    this.c = { rede: a.nucleo.rede, hospital: a.cod };
  }

  executar(op: string, entrada: unknown, login: string) {
    return this.a.executor.executar(operacao(op), this.a.cod, entrada, contexto(this.a, login), {
      escritor: this.e,
    });
  }

  /** Profissional com vínculo ativo, conselho e login único pela ocupação (prefixos do CBO). */
  async profissional(prefixos: readonly string[], exceto: string | null = null): Promise<Profissional> {
    const ls = await this.e.consultar(
      `SELECT FIRST 40 r.ID V, u.NOME L FROM TBCBOPRO r JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS
         JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')} JOIN TBCBOSUS s ON s.ID = r.ID_TBCBOSUS
        WHERE COALESCE(r.ATIVO, 'T') <> 'F' AND r.COD > 0 AND (${prefixos.map(() => 's.COD STARTING WITH ?').join(' OR ')})
        ORDER BY r.ID DESC`,
      [...prefixos],
      { teto: 40 },
    );
    for (const x of ls) {
      const login = txt(x['L']);
      if (login === exceto) continue;
      const [n] = await this.e.consultar('SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [login], {
        teto: 1,
      });
      if (num(n?.['N']) === 1) return { login, vinculo: num(x['V']) };
    }
    throw new Error(`Nenhum profissional ${prefixos.join('/')} na cópia.`);
  }

  /** Atendimento do tipo com a conta do setor aberta e os retratos vigentes. */
  async atendimento(
    tipo: 'I' | 'E',
  ): Promise<{ id: number; paciente: number; retratos: { htAtendimento: number; htPaciente: number } }> {
    const ls = await this.e.consultar(
      `SELECT FIRST 10 a.ID, a.ID_RICADPAC P FROM ATCABECATEND a
        WHERE a.TP_ATENDIMENTO = ? AND a.DATA_HORA_ENTRADA >= DATEADD(-365 DAY TO CURRENT_DATE)
          AND EXISTS (SELECT 1 FROM SICADATE s WHERE s.ID_ATCABECATEND = a.ID AND s.REG = a.COD_ATENDIMENTO AND s.ATEND = a.TP_ATENDIMENTO)
          AND EXISTS (SELECT 1 FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = a.ID)
        ORDER BY a.ID DESC`,
      [tipo],
      { teto: 10, tempoMaximoMs: 120_000 },
    );
    for (const l of ls) {
      const a = await this.porta.atendimento(this.c, num(l['ID']));
      if (a?.retratos && a.conta) return { id: a.atendimento, paciente: num(l['P']), retratos: a.retratos };
    }
    throw new Error(`Nenhum atendimento ${tipo} com a conta do setor na cópia.`);
  }

  /** Um exame parametrizado do laboratório (um valor, com material e recipiente), com faixa de referência no cadastro. */
  async exameLaboratorio(): Promise<{ id: number; codigo: string }> {
    const [x] = await this.e.consultar(
      `SELECT FIRST 1 t.ID, t.CODALF FROM SITABPRO t WHERE t.ATO = 15 AND COALESCE(t.SITUACAO, 'A') <> 'I'
          AND COALESCE(t.SOMENTE_SOLICITACAO_PEP, 'F') <> 'T' AND t.VARIAVEL = 'P' AND t.ALFANUM = 'F'
          AND t.MATERIAL IS NOT NULL AND t.RECIPIENTE IS NOT NULL ORDER BY t.ID`,
      [],
      { teto: 1 },
    );
    if (!x) throw new Error('Nenhum exame parametrizado do laboratório na cópia.');
    return { id: num(x['ID']), codigo: txt(x['CODALF']) };
  }

  async prestadorELocal(ato: number): Promise<{ prestador: number; local: number }> {
    const [x] = await this.e.consultar(
      `SELECT FIRST 1 s.ID_TBPRESER P, s.LOCAL L, COUNT(*) N FROM SILANEXA s
        WHERE s.ATO = ? AND s.DATA >= '2026-06-01' AND s.PEND_SADT = 'F' AND s.ID_TBPRESER IS NOT NULL AND s.LOCAL > 0
        GROUP BY 1, 2 ORDER BY 3 DESC`,
      [ato],
      { teto: 1, tempoMaximoMs: 120_000 },
    );
    if (!x) throw new Error(`Nenhum prestador do ato ${ato} na cópia.`);
    return { prestador: num(x['P']), local: num(x['L']) };
  }

  /** Lança o exame do laboratório no setor pelo executor e devolve o ID do exame. */
  async lancar(
    tipo: 'I' | 'E',
    quem: Profissional,
  ): Promise<{ id: number; atendimento: number; paciente: number }> {
    const at = await this.atendimento(tipo);
    const ex = await this.exameLaboratorio();
    const pl = await this.prestadorELocal(15);
    const r = await this.executar(
      'sadt.lancarExame',
      {
        atendimento: at.id,
        ato: 15,
        atend: tipo,
        itens: [{ exame: ex.id, urgente: false }],
        executante: quem.vinculo,
        prestador: pl.prestador,
        local: pl.local,
        solicitante: quem.vinculo,
        retratos: at.retratos,
        confirmarAlertas: true,
        repeticaoMinimaHoras: 0,
      },
      quem.login,
    );
    return { id: num(r.resultado['primeiro']), atendimento: at.id, paciente: at.paciente };
  }

  async lido(id: number) {
    const x = await lerExameSadt(this.e, id);
    if (!x) throw new Error('Exame não relido.');
    return { id, chave: x.chave, versao: x.versao };
  }

  async digitar(id: number, quem: Profissional, valor: number): Promise<void> {
    await this.executar(
      'sadt.registrarResultado',
      {
        exame: await this.lido(id),
        elementos: [{ elemento: 0, numerico: valor, alfa: null, absoluta: null }],
      },
      quem.login,
    );
  }

  async liberar(id: number, quem: Profissional): Promise<void> {
    await this.executar(
      'sadt.liberarExame',
      { exames: [await this.lido(id)], responsavel: quem.vinculo, confirmarCritico: true },
      quem.login,
    );
  }

  /** A faixa crítica (SGH_) do exame no elemento 0, para o aviso da liberação. */
  async faixaCritica(exame: string, acimaDe: number): Promise<void> {
    await this.porta.gravarSgh(
      this.c,
      {
        rede: this.c.rede,
        hospital: this.c.hospital,
        usuario: 'SGH.TESTE',
        evento: 'sadt.valorCritico.alterado',
        recurso: 'sadt.critico',
        operacao: 'faixa crítica (teste)',
        tabelaAlvo: 'SGH_SADT_VALOR_CRITICO',
        idAlvo: exame,
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'teste',
        correlacao: `int-m26-${Date.now()}`,
        idPaciente: null,
      },
      (g) =>
        g.gravarValorCritico({
          ato: 15,
          exame,
          elemento: 0,
          abaixoDe: null,
          acimaDe,
          prazoMinutos: 30,
          aprovacao: 'Teste de integração (sintético)',
          ativo: true,
          usuario: 'SGH.TESTE',
        }),
    );
  }
}
