// Reprodução dos cenários de assinatura do SADT (M26; ficha, seção 9) pelo EXECUTOR, na transação da captura (sempre
// desfeita). A preparação (antes do retrato "antes") monta pelo próprio executor o estado de partida: o pedido do
// prontuário (pep.solicitarExame, M23), o exame lançado no setor, o resultado digitado e liberado, o atendimento de
// requisição de laboratório aberto (atendimento.abrirAtendimento, M20, com o paciente sintético); o cenário executa só
// a receita sob teste. Os profissionais (executante, responsável técnico, médico laudador), os atendimentos com conta do
// setor, os exames do cadastro e os prestadores são os da cópia, só os IDs e o login em memória (nunca impressos). O
// conteúdo digitado é SINTÉTICO (marca "SINTETICO M26").
import { condicaoLoginDoProfissional } from '@sgh/legado';
import { documentoPedidoExame } from '@sgh/dominio-pep';
import {
  cabecalhoDocumento,
  type CenarioCaptura,
  chaveDoExameSadt,
  conferirNomeObjeto,
  type Leitor,
  lerMetadadosTabela,
  ErroOperacao,
  type Escritor,
  lerExameSadt,
  numDoBanco,
  SITUACAO_DOC,
  TIPO_ATO,
} from '@sgh/legado';
import { cabecalhoDoAto } from '@sgh/dominio-pep';
import { randomUUID } from 'node:crypto';
import { horarioClinico } from './reproducao-pep.js';
import { cepCompleto, cpfLivre, pacienteSintetico } from './sintetica.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
  operador?: string,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_SADT = new Set([
  'sadt.abrirRequisicao',
  'sadt.receberSolicitacao',
  'sadt.lancarExame',
  'sadt.registrarResultado',
  'sadt.registrarLaudo',
  'sadt.liberarExame',
  'sadt.retificarResultado',
  'sadt.emitirLaudo',
  'sadt.criarOrcamento',
  'sadt.registrarVisualizacaoPortal',
  'cadastro.cadastrarSolicitante',
]);

export const MARCA_M26 = 'SINTETICO M26';
const num = (v: unknown) => Number(v ?? 0);
const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
let seq = 0;

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

export interface ProfissionalSadt {
  readonly login: string;
  readonly cbo: number;
}

/** Profissional da cópia com vínculo ativo, conselho, login único e a ocupação (CBO) pelos prefixos. */
export async function profissionalComCbo(
  e: Escritor,
  prefixos: readonly string[],
  exceto: string | null = null,
): Promise<ProfissionalSadt> {
  const cond = prefixos.map(() => 's.COD STARTING WITH ?').join(' OR ');
  const ls = await e.consultar(
    `SELECT FIRST 40 r.ID CBO, u.NOME LOGIN FROM TBCBOPRO r JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS
       JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')} JOIN TBCBOSUS s ON s.ID = r.ID_TBCBOSUS
      WHERE COALESCE(r.ATIVO, 'T') <> 'F' AND r.COD > 0 AND (${cond}) ORDER BY r.ID DESC`,
    [...prefixos],
    { teto: 40 },
  );
  for (const l of ls) {
    const p = { login: txt(l['LOGIN']), cbo: num(l['CBO']) };
    if (p.login === exceto) continue;
    const [n] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [p.login], { teto: 1 });
    if (num(n?.['N']) === 1) return p;
  }
  throw new Error(`Nenhum profissional ${prefixos.join('/')} com vínculo ativo na cópia.`);
}

export interface AtendimentoComConta {
  readonly id: number;
  readonly paciente: number;
  readonly atend: 'I' | 'E';
  readonly retratos: { readonly htAtendimento: number; readonly htPaciente: number };
}

/** Atendimento do tipo com a conta do setor aberta e os retratos vigentes (só IDs, em memória). */
export async function atendimentoComContaSadt(e: Escritor, tipo: 'I' | 'E'): Promise<AtendimentoComConta> {
  const ls = await e.consultar(
    `SELECT FIRST 10 a.ID, a.ID_RICADPAC P FROM ATCABECATEND a
      WHERE a.TP_ATENDIMENTO = ? AND a.DATA_HORA_ENTRADA >= DATEADD(-365 DAY TO CURRENT_DATE)
        AND EXISTS (SELECT 1 FROM SICADATE s WHERE s.ID_ATCABECATEND = a.ID AND s.REG = a.COD_ATENDIMENTO AND s.ATEND = a.TP_ATENDIMENTO)
        AND EXISTS (SELECT 1 FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = a.ID)
      ORDER BY a.ID DESC`,
    [tipo],
    { teto: 10, tempoMaximoMs: 120_000 },
  );
  for (const l of ls) {
    const id = num(l['ID']);
    const [x] = await e.consultar(
      `SELECT (SELECT MAX(h.ID) FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = ?) HA,
              (SELECT MAX(p.ID) FROM HTPACIENTE p WHERE p.ID_RICADPAC = ?) HP FROM RDB$DATABASE`,
      [id, num(l['P'])],
      { teto: 1 },
    );
    if (x?.['HA'] && x['HP'])
      return {
        id,
        paciente: num(l['P']),
        atend: tipo,
        retratos: { htAtendimento: num(x['HA']), htPaciente: num(x['HP']) },
      };
  }
  throw new Error(`Nenhum atendimento ${tipo} com a conta do setor na cópia.`);
}

/** Um exame ativo do ato no cadastro, pelo filtro (laboratório com material, parametrizado, texto…). */
async function exameDoAto(
  e: Escritor,
  ato: number,
  filtro = '',
  parametros: unknown[] = [],
): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 t.ID FROM SITABPRO t WHERE t.ATO = ? AND COALESCE(t.SITUACAO, 'A') <> 'I'
        AND COALESCE(t.SOMENTE_SOLICITACAO_PEP, 'F') <> 'T' ${filtro} ORDER BY t.ID`,
    [ato, ...parametros],
    { teto: 1 },
  );
  if (!x) throw new Error(`Nenhum exame do ato ${ato} no cadastro da cópia.`);
  return num(x['ID']);
}

/** O prestador e o local mais usados do ato nos exames recebidos (o padrão do setor). */
async function prestadorELocal(e: Escritor, ato: number): Promise<{ prestador: number; local: number }> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 s.ID_TBPRESER P, s.LOCAL L, COUNT(*) N FROM SILANEXA s
      WHERE s.ATO = ? AND s.DATA >= '2026-06-01' AND s.PEND_SADT = 'F' AND s.ID_TBPRESER IS NOT NULL AND s.LOCAL > 0
      GROUP BY 1, 2 ORDER BY 3 DESC`,
    [ato],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error(`Nenhum prestador do ato ${ato} na cópia.`);
  return { prestador: num(x['P']), local: num(x['L']) };
}

const HASH = 'b'.repeat(64);

export function cenarioSadt(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  executar: Executar,
  executarOutra: ExecutarOutra,
  definirOperador: (login: string) => void,
  operadorSintetico: (e: Escritor) => Promise<string>,
  tiposLogradouro: () => ReadonlySet<string>,
): CenarioCaptura & { entradasDaPreparacao(): Record<string, unknown> } {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  /** Os exames do cenário (SILANEXA.ID), para as chaves-alvo dos resultados e das liberações. */
  const exames = new Set<number>();
  let alvos: Record<string, Record<string, unknown>[]> = {};

  const lerAlvos = async (e: Escritor) => {
    const r: Record<string, Record<string, unknown>[]> = { SILANEXA: [], SIRES01: [], SILIBERACAOEXAME: [] };
    for (const id of exames) {
      // O exame do cenário pela chave (a tabela grande: o UPDATE com as colunas que mudaram de fato).
      r['SILANEXA']!.push({ ID: id });
      const rs = await e.consultar('SELECT ID FROM SIRES01 WHERE ID_SILANEXA = ?', [id], { teto: 400 });
      for (const x of rs) r['SIRES01']!.push({ ID: x['ID'] });
      const ls = await e.consultar('SELECT ID FROM SILIBERACAOEXAME WHERE ID_SILANEXA = ?', [id], {
        teto: 100,
      });
      for (const x of ls) r['SILIBERACAOEXAME']!.push({ ID: x['ID'] });
    }
    alvos = r;
  };

  const lido = async (e: Escritor, id: number) => {
    const x = await lerExameSadt(e, id);
    if (!x) throw new Error('Exame da preparação não relido.');
    return { id, chave: x.chave, versao: x.versao };
  };

  /** Lança um exame no setor (o estado de partida da digitação, da liberação e do laudo). */
  const lancar = async (
    e: Escritor,
    at: AtendimentoComConta,
    ato: number,
    exame: number,
    executante: ProfissionalSadt,
    o: { urgente?: boolean } = {},
  ): Promise<number> => {
    const pl = await prestadorELocal(e, ato);
    const r = await executarOutra(
      e,
      'sadt.lancarExame',
      {
        atendimento: at.id,
        ato,
        atend: at.atend,
        itens: [{ exame, urgente: o.urgente === true }],
        executante: executante.cbo,
        prestador: pl.prestador,
        local: pl.local,
        solicitante: executante.cbo,
        retratos: at.retratos,
        confirmarAlertas: true,
        repeticaoMinimaHoras: 0,
      },
      executante.login,
    );
    const id = num(r.resultado['primeiro']);
    exames.add(id);
    return id;
  };

  /** Digita o resultado de laboratório (parametrizado: elemento 0) na preparação. */
  const digitarLab = async (e: Escritor, id: number, quem: ProfissionalSadt, valor = 4.5) => {
    await executarOutra(
      e,
      'sadt.registrarResultado',
      { exame: await lido(e, id), elementos: [{ elemento: 0, numerico: valor, alfa: null, absoluta: null }] },
      quem.login,
    );
  };
  const liberar = async (e: Escritor, id: number, resp: ProfissionalSadt) => {
    await executarOutra(
      e,
      'sadt.liberarExame',
      { exames: [await lido(e, id)], responsavel: resp.cbo },
      resp.login,
    );
  };

  const preparar = async (e: Escritor): Promise<void> => {
    switch (nome) {
      case 'sadt.abrirRequisicao': {
        if (cenario === 'externo-convenio') {
          const op = await operadorSintetico(e);
          const cpf = await cpfLivre(e, (Date.now() + 7919 * ++seq) % 90_000_000);
          const cep = await cepCompleto(e, tiposLogradouro());
          const pac = await executarOutra(
            e,
            'cadastro.cadastrarPaciente',
            pacienteSintetico('com-cep', cpf, cep),
            op,
          );
          const [x] = await e.consultar(
            `SELECT FIRST 1 r.CONV V, r.ID_TBCBOPROCRM P, r.UNIDADE U, r.CDC C, r.PROCED X, r.ID_TBMEDSOL S
               FROM RECADATE r JOIN TBCONVEN c ON c.COD = r.CONV JOIN TBCBOPRO b ON b.ID = r.ID_TBCBOPROCRM
              WHERE r.LAB = 'S' AND r.ID_TBMEDSOL IS NOT NULL AND r.CONV > 1 AND c.SITUACAO = 'A'
                AND COALESCE(b.ATIVO, 'T') <> 'F' AND r.DATA_HORA_INCLUSAO >= '2026-03-01' ORDER BY r.REG DESC`,
            [],
            { teto: 1, tempoMaximoMs: 120_000 },
          );
          if (!x) throw new Error('Nenhuma requisição de laboratório recente na cópia.');
          const ab = await executarOutra(
            e,
            'atendimento.abrirAtendimento',
            {
              tipo: 'requisicaoLab',
              paciente: num(pac.resultado['idPaciente']),
              convenio: num(x['V']),
              plano: 'PLANO SINTETICO',
              matricula: '900000000026',
              validadeCarteira: '2030-12-31',
              profissional: num(x['P']),
              especialidade: 0,
              unidade: num(x['U']),
              centroCusto: num(x['C']),
              procedimento: num(x['X']),
              carater: 'eletivo',
              solicitante: num(x['S']),
              dataRequisicao: '2026-01-15',
            },
            op,
          );
          const [cab] = await e.consultar(
            'SELECT ID_ATCABECATEND C FROM RECADATE WHERE REG = ?',
            [num(ab.resultado['reg'])],
            {
              teto: 1,
            },
          );
          definirOperador(op);
          entrada = { atendimento: num(cab?.['C']), emissor: num(x['P']), medicoExterno: num(x['S']) };
          return;
        }
        if (cenario === 'pedido-consulta') {
          // Uma consulta recente da cópia ainda sem a conta do setor (o prontuário abriria no primeiro pedido).
          const [x] = await e.consultar(
            `SELECT FIRST 1 r.ID_ATCABECATEND A, r.ID_TBCBOPROCRM P, u.NOME L FROM RECADATE r
               JOIN TBCBOPRO b ON b.ID = r.ID_TBCBOPROCRM JOIN TBPROFIS f ON f.ID = b.ID_TBPROFIS
               JOIN TBUSERS u ON ${condicaoLoginDoProfissional('f').replace(/\?/g, 'u.NOME')}
              WHERE r.TIPO_ATE = 4 AND r.LAB = 'N' AND r.DT_ATE >= '2026-06-01' AND COALESCE(b.ATIVO, 'T') <> 'F' AND b.COD > 0
                AND NOT EXISTS (SELECT 1 FROM SICADATE s WHERE s.REG = r.REG AND s.ATEND = 'E')
              ORDER BY r.REG DESC`,
            [],
            { teto: 1, tempoMaximoMs: 120_000 },
          );
          if (!x) throw new Error('Nenhuma consulta recente sem a conta do setor na cópia.');
          definirOperador(txt(x['L']));
          entrada = { atendimento: num(x['A']), emissor: num(x['P']), solicitante: num(x['P']) };
          return;
        }
        // recusa: o atendimento já tem a conta do setor.
        const at = await atendimentoComContaSadt(e, 'E');
        const med = await profissionalComCbo(e, ['225']);
        definirOperador(med.login);
        entrada = { atendimento: at.id, emissor: med.cbo, solicitante: med.cbo };
        recusaEsperada = 'requisicao-aberta';
        return;
      }
      case 'sadt.receberSolicitacao': {
        const med = await profissionalComCbo(e, ['225']);
        const at = await atendimentoComContaSadt(e, 'E');
        const exame = await exameDoAto(e, 15, 'AND t.MATERIAL IS NOT NULL');
        const horario = await horarioClinico(e);
        const cabD = await cabecalhoDocumento(
          e,
          at.retratos,
          med.cbo,
          SITUACAO_DOC.solicitado,
          TIPO_ATO.pedidoExame,
        );
        const ped = await executarOutra(
          e,
          'pep.solicitarExame',
          {
            paciente: at.paciente,
            atendimento: at.id,
            cbo: med.cbo,
            retratos: at.retratos,
            dataHoraClinica: horario,
            itens: [{ exame, urgente: false, indicacao: `Investigação ${MARCA_M26}` }],
            documento: documentoPedidoExame(cabecalhoDoAto(cabD, horario), '{{ORIGEM}}', [
              {
                controle: exame,
                codigoAlfa: null,
                descricao: `EXAME ${exame}`,
                material: null,
                seq: 1,
                ato: 'Exame',
                previsaoColeta: null,
                urgente: false,
                informacoes: MARCA_M26,
              },
            ]),
            hashConteudo: HASH,
          },
          med.login,
        );
        const id = num(ped.resultado['primeiro']);
        exames.add(id);
        if (cenario === 'recusa-suspenso') {
          // O pedido suspenso no prontuário (como o outro sistema grava a suspensão: usuário, data e justificativa).
          await e.executar(
            `UPDATE SILANEXA SET PEND_SADT = 'S', USUARIO_SUSPENSAO_PEP = ?, DATA_HORA_SUSPENSAO_PEP = CURRENT_TIMESTAMP,
               JUSTIFICATIVA_SUSPENSAO_PEP = ? WHERE ID = ?`,
            [med.login, Buffer.from(`Suspenso ${MARCA_M26}`, 'latin1'), id],
          );
          recusaEsperada = 'pedido-suspenso';
        }
        const exe = await profissionalComCbo(e, ['2212', '2234', '225335']);
        const pl = await prestadorELocal(e, 15);
        definirOperador(exe.login);
        entrada = {
          exames: [await lido(e, id)],
          executante: exe.cbo,
          prestador: pl.prestador,
          local: pl.local,
        };
        return;
      }
      case 'sadt.lancarExame': {
        const lab =
          cenario === 'laboratorio-internado' ||
          cenario === 'urgente' ||
          cenario === 'abo-rh' ||
          cenario.startsWith('recusa');
        const at = await atendimentoComContaSadt(
          e,
          cenario === 'laboratorio-internado' || cenario === 'urgente' || cenario === 'abo-rh' ? 'I' : 'E',
        );
        const ato = lab ? 15 : cenario === 'metodos-graficos' ? 90 : 24;
        const exe = lab
          ? await profissionalComCbo(e, ['2212', '2234', '225335'])
          : await profissionalComCbo(e, ['225']);
        let exame: number;
        if (cenario === 'recusa-inativo') {
          const [x] = await e.consultar(
            "SELECT FIRST 1 ID FROM SITABPRO WHERE ATO = 15 AND SITUACAO = 'I' ORDER BY ID",
            [],
            {
              teto: 1,
            },
          );
          exame = num(x?.['ID']);
          recusaEsperada = 'exame-inativo';
        } else if (cenario === 'abo-rh')
          // M47 (etapa 2): a tipagem ABO e Rh do cadastro de exames do laboratório (o código em uso no perfil).
          exame = await exameDoAto(e, 15, "AND t.CODALF = 'TIPS'");
        else
          exame = await exameDoAto(
            e,
            ato,
            lab ? 'AND t.MATERIAL IS NOT NULL AND t.RECIPIENTE IS NOT NULL' : '',
          );
        const pl = await prestadorELocal(e, ato);
        definirOperador(exe.login);
        entrada = {
          atendimento: at.id,
          ato,
          atend: at.atend,
          itens: [{ exame, urgente: cenario === 'urgente' }],
          executante: exe.cbo,
          prestador: pl.prestador,
          local: pl.local,
          solicitante: exe.cbo,
          retratos: at.retratos,
          confirmarAlertas: true,
          repeticaoMinimaHoras: 0,
          ...(cenario === 'recusa-data-fora-da-faixa' ? { dataHora: '5202-01-01T10:00' } : {}),
        };
        if (cenario === 'recusa-data-fora-da-faixa') recusaEsperada = 'data-fora-da-faixa';
        return;
      }
      case 'sadt.registrarLaudo':
      case 'sadt.registrarResultado': {
        const imagem = nome === 'sadt.registrarLaudo';
        const at = await atendimentoComContaSadt(e, 'E');
        if (imagem) {
          const med = await profissionalComCbo(e, ['225']);
          const exame =
            cenario === 'eco-estruturado'
              ? await exameDoAto(e, 24, "AND t.CODALF = 'ETRT'")
              : await exameDoAto(e, 24, "AND t.CODALF <> 'ETRT'");
          const id = await lancar(e, at, 24, exame, med);
          const vars =
            cenario === 'eco-estruturado'
              ? (
                  await e.consultar(
                    "SELECT FIRST 2 CODIGO FROM SIVARFORMULA WHERE ATO = 24 AND EXAME = 'ETRT' ORDER BY CODIGO",
                    [],
                    {
                      teto: 2,
                    },
                  )
                ).map((x, i) => ({ codigo: num(x['CODIGO']), valor: 50 + i }))
              : [];
          let emissor = med;
          if (cenario === 'recusa-laudo-nao-medico') {
            emissor = await profissionalComCbo(e, ['2212', '2235', '3222']);
            recusaEsperada = 'laudo-privativo-de-medico';
          }
          definirOperador(emissor.login);
          entrada = {
            exame: await lido(e, id),
            elementos: [],
            observacoes: [],
            variaveis: vars,
            laudo: {
              texto: `Laudo sintético ${MARCA_M26}: exame dentro da normalidade. Ação, pé, avó.`,
              html: `<p>Laudo sintético ${MARCA_M26}: exame dentro da normalidade.</p>`,
            },
            emissor: emissor.cbo,
          };
          return;
        }
        const tec = await profissionalComCbo(e, ['2212', '2234', '225335', '3242']);
        const texto = cenario === 'texto-observacao';
        const exame = await exameDoAto(
          e,
          15,
          texto
            ? "AND t.VARIAVEL = 'P' AND t.ALFANUM = 'T' AND t.MATERIAL IS NOT NULL"
            : "AND t.VARIAVEL = 'P' AND t.ALFANUM = 'F' AND t.MATERIAL IS NOT NULL",
        );
        const id = await lancar(e, at, 15, exame, tec);
        if (cenario === 'recusa-liberado') {
          const resp = await profissionalComCbo(e, ['2212', '2234', '225335']);
          await digitarLab(e, id, resp);
          await liberar(e, id, resp);
          recusaEsperada = 'resultado-liberado';
        }
        definirOperador(tec.login);
        if (cenario === 'origem-apoio') {
          // M34 (regra 13): o retorno do laboratório de apoio, casado pelo de-para e conferido pelo responsável
          // técnico (o emissor); a observação leva o protocolo do laboratório.
          const rt = await profissionalComCbo(e, ['2212', '2234', '225335'], tec.login);
          entrada = {
            exame: await lido(e, id),
            elementos: [{ elemento: 0, numerico: 5.2, alfa: null, absoluta: null }],
            observacoes: [`Laboratório de apoio, protocolo AP-${MARCA_M26.replace(/\D/g, '')}-${++seq}.`],
            variaveis: [],
            emissor: rt.cbo,
          };
          return;
        }
        entrada = {
          exame: await lido(e, id),
          elementos: [
            texto
              ? { elemento: 0, numerico: null, alfa: `NÃO REAGENTE ${MARCA_M26}`, absoluta: null }
              : { elemento: 0, numerico: 4.5, alfa: null, absoluta: null },
          ],
          observacoes: texto ? [`Observação ${MARCA_M26}: amostra conferida. Ação, pé, avó.`] : [],
          variaveis: [],
        };
        return;
      }
      case 'sadt.liberarExame':
      case 'sadt.retificarResultado':
      case 'sadt.registrarVisualizacaoPortal':
      case 'sadt.emitirLaudo': {
        const at = await atendimentoComContaSadt(e, 'E');
        const resp = await profissionalComCbo(e, ['2212', '2234', '225335']);
        const exameId = await exameDoAto(
          e,
          15,
          "AND t.VARIAVEL = 'P' AND t.ALFANUM = 'F' AND t.MATERIAL IS NOT NULL",
        );
        const id = await lancar(e, at, 15, exameId, resp);
        await digitarLab(e, id, resp);
        if (nome === 'sadt.liberarExame') {
          let quem = resp;
          if (cenario === 'recusa-sem-habilitacao') {
            quem = await profissionalComCbo(e, ['2251', '2252'], resp.login);
            recusaEsperada = 'sem-habilitacao';
          }
          definirOperador(quem.login);
          entrada = { exames: [await lido(e, id)], responsavel: quem.cbo };
          return;
        }
        if (nome === 'sadt.retificarResultado') {
          if (cenario === 'recusa-nao-liberado') recusaEsperada = 'resultado-nao-liberado';
          else await liberar(e, id, resp);
          definirOperador(resp.login);
          entrada = {
            exame: await lido(e, id),
            motivo: `Correção de digitação ${MARCA_M26}`,
            elementos: [{ elemento: 0, numerico: 5.1, alfa: null, absoluta: null }],
            responsavel: resp.cbo,
          };
          return;
        }
        if (nome === 'sadt.emitirLaudo') {
          const outro = await lancar(e, at, 15, exameId, resp);
          await digitarLab(e, outro, resp, 3.3);
          if (cenario === 'recusa-nao-liberado') recusaEsperada = 'resultado-nao-liberado';
          else {
            await liberar(e, id, resp);
            await liberar(e, outro, resp);
          }
          definirOperador(resp.login);
          entrada = { exames: [id, outro], codigo: randomUUID(), hashPdf: HASH, segundaVia: false };
          return;
        }
        // Visualização no portal: a liberação para visualização do exame liberado.
        await liberar(e, id, resp);
        const [l] = await e.consultar(
          'SELECT FIRST 1 ID FROM SILIBERACAOEXAME WHERE ID_SILANEXA = ? AND SITUACAO = 1 ORDER BY ID DESC',
          [id],
          { teto: 1 },
        );
        entrada = { liberacao: num(l?.['ID']), ip: '127.0.0.26', acao: 'visualizacao' };
        if (cenario === 'recusa-ja-visto') {
          await executarOutra(e, 'sadt.registrarVisualizacaoPortal', entrada, resp.login);
          recusaEsperada = 'ja-visto';
        }
        definirOperador(resp.login);
        return;
      }
      case 'sadt.criarOrcamento': {
        const ls = await e.consultar(
          "SELECT FIRST 3 CODALF FROM SITABPRO WHERE ATO = 15 AND COALESCE(SITUACAO, 'A') <> 'I' AND MATERIAL IS NOT NULL ORDER BY ID",
          [],
          { teto: 3 },
        );
        const itens = ls.map((x, i) => ({ exame: txt(x['CODALF']), valor: 12.5 + i * 10 }));
        if (cenario === 'recusa-exame-inativo') {
          itens[0] = { exame: 'ZZZ9', valor: 1 };
          recusaEsperada = 'exame-inativo';
        }
        definirOperador(await operadorSintetico(e));
        entrada = {
          nome: `PACIENTE ${MARCA_M26} ORCAMENTO ${Date.now().toString(36).toUpperCase()}`,
          convenio: 10,
          ato: 15,
          itens,
          validadeDias: 30,
        };
        return;
      }
      case 'cadastro.cadastrarSolicitante': {
        definirOperador(await operadorSintetico(e));
        if (cenario === 'recusa-duplicado') {
          const [x] = await e.consultar(
            "SELECT FIRST 1 COD_CONSELHO_PROFISSIONAL N, ID_TBUF U, ID_TBCONSPROF C FROM TBMEDSOL WHERE COD_CONSELHO_PROFISSIONAL > 0 AND ID_TBUF <> '' AND ID_TBCONSPROF IS NOT NULL AND ATIVO = 'T' ORDER BY ID DESC",
            [],
            { teto: 1 },
          );
          entrada = {
            nome: `MEDICO ${MARCA_M26}`,
            conselho: num(x?.['C']),
            uf: txt(x?.['U']),
            numero: num(x?.['N']),
          };
          recusaEsperada = 'solicitante-duplicado';
          return;
        }
        let numero = 990_000_000 + (Date.now() % 9_000_000);
        for (;;) {
          const [x] = await e.consultar(
            'SELECT COUNT(*) N FROM TBMEDSOL WHERE COD_CONSELHO_PROFISSIONAL = ?',
            [numero],
            { teto: 1 },
          );
          if (num(x?.['N']) === 0) break;
          numero++;
        }
        entrada = { nome: `MEDICO ${MARCA_M26}`, conselho: 5, uf: 'RJ', numero };
        return;
      }
      default:
        throw new Error(`Operação ${nome} sem reprodução no SADT.`);
    }
  };

  /** Os valores dos exames do cenário que a captura vê como entrada (a chave do exame e o mês do gatilho). */
  let entradasLidas: Record<string, unknown[]> = {};
  const lerEntradas = async (e: Escritor) => {
    const r: Record<string, unknown[]> = { EXAME: [], SEQUENCIA: [], MES: [] };
    for (const id of exames) {
      const [x] = await e.consultar('SELECT EXAME, SEQUENCIA, MES FROM SILANEXA WHERE ID = ?', [id], {
        teto: 1,
      });
      if (!x) continue;
      r['EXAME']!.push(x['EXAME']);
      r['SEQUENCIA']!.push(x['SEQUENCIA']);
      r['MES']!.push(x['MES']);
    }
    entradasLidas = r;
  };

  return {
    ...base,
    entradasDaPreparacao: () => entradasLidas,
    chavesAlvo: () => alvos,
    async preparar(e) {
      await preparar(e);
      await lerAlvos(e);
      await lerEntradas(e);
    },
    async executar(e) {
      if (recusaEsperada) await exigirRecusa(executar(e, entrada), recusaEsperada);
      else {
        const r = await executar(e, entrada);
        for (const k of ['primeiro', 'exame']) if (num(r.resultado[k]) > 0) exames.add(num(r.resultado[k]));
      }
      await lerAlvos(e);
      await lerEntradas(e);
    },
  };
}

void numDoBanco;
void chaveDoExameSadt;

// ── Integração do M26 (packages/testes/src/integracao/m26.int.spec.ts), na transação desfeita ───────────────────────

/** Um exame parametrizado do laboratório (um valor, com material), ativo e lançável no setor. */
export async function exameParametrizadoDoLaboratorio(e: Escritor): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 t.ID FROM SITABPRO t WHERE t.ATO = 15 AND COALESCE(t.SITUACAO, 'A') <> 'I'
        AND COALESCE(t.SOMENTE_SOLICITACAO_PEP, 'F') <> 'T' AND t.VARIAVEL = 'P' AND t.ALFANUM = 'F' AND t.MATERIAL IS NOT NULL ORDER BY t.ID`,
    [],
    { teto: 1 },
  );
  if (!x) throw new Error('Nenhum exame parametrizado do laboratório na cópia.');
  return Number(x['ID']);
}

/** O prestador e o local mais usados do ato desde junho de 2026. */
export async function prestadorELocalDoAto(
  e: Escritor,
  ato: number,
): Promise<{ prestador: number; local: number }> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 s.ID_TBPRESER P, s.LOCAL L, COUNT(*) N FROM SILANEXA s WHERE s.ATO = ? AND s.DATA >= '2026-06-01'
        AND s.PEND_SADT = 'F' AND s.ID_TBPRESER IS NOT NULL AND s.LOCAL > 0 GROUP BY 1, 2 ORDER BY 3 DESC`,
    [ato],
    { teto: 1, tempoMaximoMs: 120_000 },
  );
  if (!x) throw new Error(`Nenhum prestador do ato ${ato} na cópia.`);
  return { prestador: Number(x['P']), local: Number(x['L']) };
}

/** O técnico do outro sistema grava no exame (o mapa impresso) depois da leitura do novo: o gatilho troca o carimbo. */
export async function gravacaoDoOutroSistemaNoExame(e: Escritor, id: number): Promise<void> {
  await e.executar("UPDATE SILANEXA SET IMPMAPA = 'T' WHERE ID = ?", [id]);
}

/** A liberação com a data impossível (o ano 5202 visto nas sentinelas antigas), como uma linha antiga do outro sistema. */
export async function liberacaoImpossivelDoOutroSistema(e: Escritor, id: number): Promise<void> {
  await e.executar(
    "UPDATE SILANEXA SET RESLIB = 'T', DATA_HORA_LIBERA_EXAME = TIMESTAMP '5202-01-01 10:00:00' WHERE ID = ?",
    [id],
  );
}

/** As tabelas do outro sistema que as receitas do SADT gravam (ficha do M26, seção 5). */
export const TABELAS_GRAVADAS_SADT = [
  'SICADATE',
  'SILANEXA',
  'SIRES01',
  'SIRESOBS',
  'SIRESVAR',
  'SILIBERACAOEXAME',
  'SIORCAME',
  'SIEXAORC',
] as const;

/** As tabelas SGH_ do SADT (scripts 0260 a 0267) e as sequências delas. */
export const TABELAS_SGH_SADT = [
  'SGH_SADT_AMOSTRA',
  'SGH_SADT_AMOSTRA_EXAME',
  'SGH_SADT_AMOSTRA_EVENTO',
  'SGH_SADT_VALOR_CRITICO',
  'SGH_SADT_AVISO_CRITICO',
  'SGH_SADT_RESULT_VERSAO',
  'SGH_SADT_RESULT_LEITURA',
  'SGH_SADT_PORTAL_ACESSO',
  'SGH_SADT_ORCAMENTO',
  'SGH_SADT_LAUDO_EMITIDO',
  'SGH_SADT_LAUDO_EXAME',
] as const;

const SEQUENCIAS_SGH_SADT = [
  'SGH_GEN_SADT_AMOSTRA',
  'SGH_GEN_SADT_AMOSTRA_EVENTO',
  'SGH_GEN_SADT_VALOR_CRITICO',
  'SGH_GEN_SADT_AVISO_CRITICO',
  'SGH_GEN_SADT_RESULT_VERSAO',
  'SGH_GEN_SADT_RESULT_LEITURA',
  'SGH_GEN_SADT_ORCAMENTO',
  'SGH_GEN_SADT_PORTAL_ACESSO',
  'SGH_GEN_SADT_LAUDO_EMITIDO',
  'SGH_GEN_SADT_LAUDO_IMPRESSAO',
  'SGH_GEN_SADT_LAUDO_IMP_EXAME',
] as const;

export interface EstadoSadtPorFora {
  /** `linhas:<tabela>` e `maior:<tabela>`: o que o ROLLBACK tem de devolver igual. */
  readonly tabelas: Record<string, number>;
  /** `<generator>`: o valor atual (GEN_ID(g, 0)); GEN_ID dentro de gatilho e NEXT VALUE FOR não voltam no ROLLBACK. */
  readonly generators: Record<string, number>;
}

/**
 * Estado das tabelas do SADT (lente "contagens iguais após ROLLBACK", como o estadoDoRegistroPorFora do M15): contagem
 * e maior ID das tabelas gravadas pelas receitas e das SGH_SADT_*, e o valor dos generators dos gatilhos delas e das
 * sequências SGH_. Só números.
 */
export async function estadoDoSadtPorFora(l: Leitor): Promise<EstadoSadtPorFora> {
  const tabelas: Record<string, number> = {};
  const generators = new Set<string>(SEQUENCIAS_SGH_SADT);
  for (const t of [...TABELAS_GRAVADAS_SADT, ...TABELAS_SGH_SADT]) {
    const m = await lerMetadadosTabela(l, t);
    for (const g of m.generators) generators.add(g);
    for (const tr of m.triggers)
      if (!tr.inativo) for (const g of Object.values(tr.analise.generators)) generators.add(g);
    const comId = m.colunas.some((c) => c.nome === 'ID');
    const [r] = await l.consultar(
      `SELECT COUNT(*) N${comId ? ', MAX(ID) M' : ''} FROM ${conferirNomeObjeto(t)}`,
      [],
      { teto: 1, tempoMaximoMs: 120_000 },
    );
    tabelas[`linhas:${t}`] = numDoBanco(r?.['N']);
    if (comId) tabelas[`maior:${t}`] = numDoBanco(r?.['M'] ?? 0);
  }
  const valores: Record<string, number> = {};
  for (const g of [...generators].sort()) {
    const [r] = await l.consultar(`SELECT GEN_ID(${conferirNomeObjeto(g)}, 0) V FROM RDB$DATABASE`, [], {
      teto: 1,
    });
    valores[g] = numDoBanco(r?.['V']);
  }
  return { tabelas, generators: valores };
}
