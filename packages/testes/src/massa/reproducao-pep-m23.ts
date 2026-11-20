// Reprodução dos cenários de assinatura do M23 (ficha, seção 9) pelo EXECUTOR, na transação da captura (sempre
// desfeita): alergias, receita, atestado, declaração, correção, suspensão, sumário de alta, anexo, exame externo e
// pedido de exame. O profissional é da cópia (o executor confere que o usuário da sessão é o dono do CBO ativo; login e
// CBO só em memória, nunca impressos); o paciente e o atendimento, existentes (só IDs, em memória); o conteúdo é
// SINTÉTICO (marca "SINTETICO M23"), montado pelos mesmos construtores de @sgh/dominio-pep que a API usa.
import { condicaoLoginDoProfissional } from '@sgh/legado';
import {
  cabecalhoDoAto,
  documentoAtestado,
  documentoExameExterno,
  documentoPedidoExame,
  documentoReceita,
  linhasDaReceita,
  paragrafosDoTexto,
  rtfDaReceita,
  rtfDoCampo,
  respostasSinteticas,
  textoDoSumario,
  xmlDoAtestado,
} from '@sgh/dominio-pep';
import {
  cabecalhoDocumento,
  type CenarioCaptura,
  gravarAssinaturaIcp,
  gravarAssinaturaPdf,
  gravarCertificado,
  gravarEventoAssinadoIcp,
  gravarPreviaAssinatura,
  gravarValidacaoIcp,
  ErroOperacao,
  type Escritor,
  fichasDeImpressao,
  numDoBanco,
  SITUACAO_DOC,
  TIPO_ATO,
  versaoDasAlergiasAtivas,
} from '@sgh/legado';
import {
  type Atendimento,
  atendimento,
  gravacaoEvolucao,
  horarioClinico,
  modeloPronto,
  type Profissional,
  profissional,
} from './reproducao-pep.js';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
  operador: string,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_PEP_M23 = new Set([
  'pep.registrarAlergia',
  'pep.inativarAlergia',
  'pep.emitirDocumento',
  'pep.suspenderDocumento',
  'pep.finalizarSumarioAlta',
  'pep.anexarDocumento',
  'pep.lancarExameExterno',
  'pep.solicitarExame',
]);

export const MARCA_M23 = 'SINTETICO M23';
/**
 * Corpus CP1252 (regra 18): acentos, cedilha, aspas curvas, travessão, euro, ordinais e frações. Vai no texto da
 * receita, do atestado e na observação da alergia; a integração confere a ida e volta (e o documento da trilha).
 */
export const CORPUS_CP1252 = 'Ação, pé, avó, Ü; “aspas” – € 1,50; 1º, 2ª; ½ dose.';
const HASH = 'a'.repeat(64);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

/** Profissional da cópia por família de CBO (225: médico), com login único (só em memória). */
export async function profissionalDaCategoria(e: Escritor, medico: boolean): Promise<Profissional> {
  const ls = await e.consultar(
    `SELECT FIRST 30 r.ID CBO, u.NOME LOGIN FROM TBCBOPRO r JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS
       JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')} JOIN TBCBOSUS s ON s.ID = r.ID_TBCBOSUS
      WHERE COALESCE(r.ATIVO, 'T') <> 'F' AND r.COD > 0 AND ${medico ? "s.COD STARTING WITH '225'" : "s.COD STARTING WITH '2235'"}
      ORDER BY r.ID DESC`,
    [],
    { teto: 30 },
  );
  for (const l of ls) {
    const p = { login: String(l['LOGIN']).trim(), cbo: Number(l['CBO']) };
    const [n] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [p.login], { teto: 1 });
    if (Number(n?.['N']) === 1) return p;
  }
  throw new Error(`Nenhum profissional ${medico ? 'médico' : 'de enfermagem'} com CBO ativo na cópia.`);
}

/** Atendimento com a conta do SADT aberta (o pedido de exames usa a conta existente). */
async function atendimentoComConta(e: Escritor): Promise<Atendimento> {
  const ls = await e.consultar(
    `SELECT FIRST 10 a.ID FROM ATCABECATEND a
      WHERE EXISTS (SELECT 1 FROM SICADATE s WHERE s.ID_ATCABECATEND = a.ID AND s.REG = a.COD_ATENDIMENTO AND s.ATEND = a.TP_ATENDIMENTO)
        AND EXISTS (SELECT 1 FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = a.ID)
      ORDER BY a.ID DESC`,
    [],
    { teto: 10 },
  );
  for (const l of ls) {
    const id = Number(l['ID']);
    const [x] = await e.consultar(
      `SELECT a.ID_RICADPAC P, (SELECT MAX(h.ID) FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = a.ID) HA,
              (SELECT MAX(p.ID) FROM HTPACIENTE p WHERE p.ID_RICADPAC = a.ID_RICADPAC) HP FROM ATCABECATEND a WHERE a.ID = ?`,
      [id],
      { teto: 1 },
    );
    if (x?.['HA'] && x['HP'])
      return {
        id,
        paciente: Number(x['P']),
        retratos: { htAtendimento: Number(x['HA']), htPaciente: Number(x['HP']) },
      };
  }
  throw new Error('Nenhum atendimento com conta do SADT na cópia.');
}

/** O documento da trilha (XML) com o cabeçalho lido dos retratos, como a API monta. */
async function cabecalho(
  e: Escritor,
  at: Atendimento,
  cbo: number,
  situacao: number,
  tipoAto: number,
  evento: string,
) {
  const cab = await cabecalhoDocumento(e, at.retratos, cbo, situacao, tipoAto);
  return cabecalhoDoAto(cab, evento);
}

const ITEM_RECEITA = {
  medicamento: `DIPIRONA ${MARCA_M23}`,
  concentracao: '500 mg',
  forma: 'comprimido',
  via: 'oral',
  posologia: '1 comprimido de 6 em 6 horas se dor',
  quantidade: '10 comprimidos',
  duracao: '3 dias',
  usoContinuo: false,
};

export async function entradaReceita(
  e: Escritor,
  prof: Profissional,
  at: Atendimento,
  tipo: 'receita' | 'receita-controlada' | 'receita-antimicrobiano',
) {
  const dataHoraClinica = await horarioClinico(e);
  const itens = [ITEM_RECEITA];
  const rtf = rtfDaReceita(itens, `Retorno se piora. ${CORPUS_CP1252}`);
  const cab = await cabecalho(e, at, prof.cbo, SITUACAO_DOC.lancado, TIPO_ATO.receita, dataHoraClinica);
  return {
    familia: 'receita' as const,
    paciente: at.paciente,
    atendimento: at.id,
    cbo: prof.cbo,
    retratos: at.retratos,
    dataHoraClinica,
    tipo,
    tpPadrao: tipo === 'receita-controlada' ? (4 as const) : (1 as const),
    rtf,
    documento: documentoReceita(cab, linhasDaReceita(itens).join('\n'), rtf),
    hashConteudo: HASH,
  };
}

async function fichaPorNome(e: Escritor, nome: RegExp) {
  const fs = await fichasDeImpressao(e);
  return fs.find((f) => nome.test(f.nome)) ?? fs[0]!;
}

export async function entradaAtestado(
  e: Escritor,
  prof: Profissional,
  at: Atendimento,
  tipo: 'atestado' | 'declaracao' | 'requerimento',
  extra: { cid?: string; autorizacaoCid?: 'paciente'; corrige?: number; modeloNome?: string } = {},
) {
  const dataHoraClinica = await horarioClinico(e);
  const ficha = await fichaPorNome(e, tipo === 'atestado' ? /ATESTADO M/i : /^Atestado$/i);
  const texto = `Atesto, para os devidos fins, ${MARCA_M23}. ${CORPUS_CP1252} Afastamento de 2 dias.${extra.cid ? ` CID-10: ${extra.cid}.` : ''}`;
  const conteudoXml = xmlDoAtestado({ codigo: ficha.codigo, nome: ficha.nome }, ficha.componentes, texto);
  const cab = await cabecalho(e, at, prof.cbo, SITUACAO_DOC.lancado, TIPO_ATO.atestado, dataHoraClinica);
  return {
    familia: 'atestado' as const,
    paciente: at.paciente,
    atendimento: at.id,
    cbo: prof.cbo,
    retratos: at.retratos,
    dataHoraClinica,
    tipo,
    modeloNome: extra.modeloNome ?? ficha.nome,
    conteudoXml,
    ...(extra.cid ? { cid: extra.cid } : {}),
    ...(extra.autorizacaoCid ? { autorizacaoCid: extra.autorizacaoCid } : {}),
    ...(extra.corrige ? { corrige: extra.corrige } : {}),
    documento: documentoAtestado(cab, texto, conteudoXml),
    hashConteudo: HASH,
  };
}

async function suspensao(
  e: Escritor,
  prof: Profissional,
  at: Atendimento,
  familia: 'receita' | 'atestado',
  origem: number,
  justificativa: string,
) {
  const evento = await horarioClinico(e, 0);
  const cab = await cabecalhoDocumento(
    e,
    at.retratos,
    prof.cbo,
    SITUACAO_DOC.suspenso,
    familia === 'receita' ? TIPO_ATO.receita : TIPO_ATO.atestado,
  );
  const c = cabecalhoDoAto(cab, evento, {
    profissional: cab.profissional,
    justificativa,
    em: evento,
    gravadoEm: evento,
  });
  return {
    familia,
    paciente: at.paciente,
    origem,
    cbo: prof.cbo,
    justificativa,
    documento:
      familia === 'receita'
        ? documentoReceita(c, 'SUSPENSA', '{\\rtf1 SUSPENSA}')
        : documentoAtestado(c, 'SUSPENSO', '<atestado/>'),
  };
}

export function cenarioPepM23(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  hospital: string,
  executar: Executar,
  executarOutra: ExecutarOutra,
  definirOperador: (login: string) => void,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  let alvoUpdate: { tabela: string; coluna: string; id: number } | null = null;
  // M49, etapa 2 (`receita-assinada-icp`): depois da emissão, a assinatura ICP-Brasil do documento do novo na MESMA
  // transação (só SGH_); a gravação legada tem de ser idêntica à da receita não assinada.
  let assinarIcpComo: string | null = null;
  const rodar = async (e: Escritor) => {
    if (recusaEsperada) return exigirRecusa(executar(e, entrada), recusaEsperada);
    const r = await executar(e, entrada);
    if (assinarIcpComo)
      await assinarIcpSintetico(e, hospital, assinarIcpComo, Number(r.resultado['documento']));
  };
  const chavesAlvo = () =>
    alvoUpdate ? { [alvoUpdate.tabela]: [{ [alvoUpdate.coluna]: alvoUpdate.id }] } : {};
  // A linha alterada nasce na preparação: nas tabelas retratadas por impressão, o "antes" dela é lido na própria
  // transação, para a alteração mostrar só as colunas que mudaram.
  const chavesDaPreparacao = () => (alvoUpdate ? { [alvoUpdate.tabela]: [String(alvoUpdate.id)] } : {});

  if (nome === 'pep.registrarAlergia' || nome === 'pep.inativarAlergia') {
    return {
      ...base,
      chavesAlvo,
      chavesDaPreparacao,
      async preparar(e) {
        // O registro clínico do atendimento, feito pelo novo, pelo mesmo profissional (EVAM).
        const m = await modeloPronto(e, 'EVAM');
        const prof = await profissional(e, m.id);
        const at = await atendimento(e, 'I');
        definirOperador(prof.login);
        const g = await executarOutra(
          e,
          'pep.registrarEvolucao',
          await gravacaoEvolucao(e, hospital, m, prof, at, respostasSinteticas(m.rep)),
          prof.login,
        );
        const registro = Number(g.resultado['registro']);
        const ativos = await e.consultar(
          `SELECT a.ID_TBALERGIA A FROM PRALERGIAPAC a JOIN PRCABEVOL c ON c.ID_CABEVOL = a.ID_PRCABEVOL
             JOIN HTPACIENTE h ON h.ID = c.ID_HTPACIENTE WHERE h.ID_RICADPAC = ? AND COALESCE(a.RETIRAR_VINCULO_PACIENTE, 'F') = 'F'`,
          [at.paciente],
          { teto: 500 },
        );
        const usados = new Set(ativos.map((x) => Number(x['A'])));
        const agentes = (
          await e.consultar(
            "SELECT FIRST 60 ID, ID_TBTPALERGIA T FROM TBALERGIA WHERE COALESCE(ATIVO, 'T') = 'T' ORDER BY ID",
            [],
            {
              teto: 60,
            },
          )
        ).filter((x) => !usados.has(Number(x['ID'])));
        const medicamento = agentes.find((x) => Number(x['T']) === 3)!;
        const outro = agentes.find((x) => Number(x['T']) === 1) ?? agentes[1]!;
        const [pr] = await e.consultar(
          "SELECT FIRST 1 COD FROM TBPRINC WHERE COALESCE(ATIVO, 'T') = 'T' AND COD > 0 ORDER BY COD",
          [],
          { teto: 1 },
        );
        const base = {
          paciente: at.paciente,
          atendimento: at.id,
          cbo: prof.cbo,
          registro,
          hashConteudo: HASH,
        };
        const versao = () => versaoDasAlergiasAtivas(e, at.paciente);
        const outroAgente = {
          ...base,
          nega: false,
          agente: Number(outro['ID']),
          principios: [],
          observacao: `OBSERVACAO ${MARCA_M23} ${CORPUS_CP1252}`,
          reacao: 'Urticária',
          gravidade: 'leve' as const,
          origem: 'relato-paciente' as const,
        };
        if (nome === 'pep.inativarAlergia') {
          const r = await executarOutra(
            e,
            'pep.registrarAlergia',
            { ...outroAgente, versao: await versao() },
            prof.login,
          );
          const alergia = Number(r.resultado['alergia']);
          alvoUpdate = { tabela: 'PRALERGIAPAC', coluna: 'ID', id: alergia };
          entrada = {
            paciente: at.paciente,
            alergia,
            motivo: `Alergia superada ${MARCA_M23}`,
            versao: await versao(),
          };
          if (cenario === 'recusa-colisao') {
            await executarOutra(e, 'pep.inativarAlergia', entrada, prof.login);
            recusaEsperada = 'conflito-versao';
          }
          return;
        }
        if (cenario === 'principio-ativo')
          entrada = {
            ...base,
            nega: false,
            agente: Number(medicamento['ID']),
            principios: [Number(pr?.['COD'])],
            versao: await versao(),
          };
        else if (cenario === 'outro-agente') entrada = { ...outroAgente, versao: await versao() };
        else if (cenario === 'nega-alergias') {
          // Sem alergia ativa no paciente (retiradas na preparação, como o profissional faria antes de negar).
          for (const x of await e.consultar(
            `SELECT a.ID FROM PRALERGIAPAC a JOIN PRCABEVOL c ON c.ID_CABEVOL = a.ID_PRCABEVOL JOIN HTPACIENTE h ON h.ID = c.ID_HTPACIENTE
              WHERE h.ID_RICADPAC = ? AND COALESCE(a.RETIRAR_VINCULO_PACIENTE, 'F') = 'F'`,
            [at.paciente],
            { teto: 500 },
          ))
            await executarOutra(
              e,
              'pep.inativarAlergia',
              {
                paciente: at.paciente,
                alergia: Number(x['ID']),
                motivo: `Retirada ${MARCA_M23}`,
                versao: await versao(),
              },
              prof.login,
            );
          entrada = { ...base, nega: true, principios: [], versao: await versao() };
        } else if (cenario === 'recusa-duplicada') {
          await executarOutra(
            e,
            'pep.registrarAlergia',
            { ...outroAgente, versao: await versao() },
            prof.login,
          );
          entrada = { ...outroAgente, versao: await versao() };
          recusaEsperada = 'alergia-duplicada';
        } else {
          entrada = { ...base, nega: false, agente: 999_999, principios: [], versao: await versao() };
          recusaEsperada = 'dominio-nao-visto';
        }
      },
      executar: rodar,
    };
  }

  if (nome === 'pep.emitirDocumento' || nome === 'pep.suspenderDocumento') {
    return {
      ...base,
      chavesAlvo,
      chavesDaPreparacao,
      async preparar(e) {
        const medico = await profissionalDaCategoria(e, true);
        const at = await atendimento(e, 'I');
        definirOperador(medico.login);
        if (nome === 'pep.suspenderDocumento') {
          const familia = cenario === 'atestado' ? 'atestado' : 'receita';
          const emitido = await executarOutra(
            e,
            'pep.emitirDocumento',
            familia === 'receita'
              ? await entradaReceita(e, medico, at, 'receita')
              : await entradaAtestado(e, medico, at, 'atestado'),
            medico.login,
          );
          const origem = Number(emitido.resultado['origem']);
          alvoUpdate =
            familia === 'receita'
              ? { tabela: 'PRRECEITA', coluna: 'ID_RECEITA', id: origem }
              : { tabela: 'PRATESTREQIMP', coluna: 'ID', id: origem };
          entrada = await suspensao(
            e,
            medico,
            at,
            familia,
            origem,
            `Emitido no paciente errado ${MARCA_M23}`,
          );
          if (cenario === 'recusa-sem-justificativa') {
            entrada = { ...(entrada as object), justificativa: '' };
            recusaEsperada = 'entrada-invalida';
          } else if (cenario === 'recusa-ja-suspenso') {
            await executarOutra(e, 'pep.suspenderDocumento', entrada, medico.login);
            recusaEsperada = 'ja-suspenso';
          }
          return;
        }
        if (cenario === 'receita-assinada-icp') {
          entrada = await entradaReceita(e, medico, at, 'receita-controlada');
          assinarIcpComo = medico.login;
        } else if (cenario.startsWith('receita'))
          entrada = await entradaReceita(
            e,
            medico,
            at,
            cenario === 'receita-controlada'
              ? 'receita-controlada'
              : cenario === 'receita-antimicrobiano'
                ? 'receita-antimicrobiano'
                : 'receita',
          );
        else if (cenario === 'atestado-com-cid')
          entrada = await entradaAtestado(e, medico, at, 'atestado', {
            cid: 'J11',
            autorizacaoCid: 'paciente',
          });
        else if (cenario === 'atestado-sem-cid') entrada = await entradaAtestado(e, medico, at, 'atestado');
        else if (cenario === 'declaracao') entrada = await entradaAtestado(e, medico, at, 'declaracao');
        else if (cenario === 'atestado-correcao') {
          const original = await executarOutra(
            e,
            'pep.emitirDocumento',
            await entradaAtestado(e, medico, at, 'atestado'),
            medico.login,
          );
          const id = Number(original.resultado['origem']);
          await executarOutra(
            e,
            'pep.suspenderDocumento',
            await suspensao(e, medico, at, 'atestado', id, `Dias de afastamento errados ${MARCA_M23}`),
            medico.login,
          );
          entrada = await entradaAtestado(e, medico, at, 'atestado', { corrige: id });
        } else if (cenario === 'recusa-cid-sem-autorizacao') {
          entrada = await entradaAtestado(e, medico, at, 'atestado', { cid: 'J11' });
          recusaEsperada = 'cid-sem-autorizacao';
        } else if (cenario === 'recusa-nao-medico') {
          const enf = await profissionalDaCategoria(e, false);
          definirOperador(enf.login);
          entrada = await entradaAtestado(e, enf, at, 'atestado');
          recusaEsperada = 'categoria-nao-permitida';
        } else {
          entrada = {
            ...(await entradaAtestado(e, medico, at, 'atestado')),
            modeloNome: 'ATESTADO \u{1F600}',
          };
          recusaEsperada = 'entrada-invalida';
        }
      },
      executar: rodar,
    };
  }

  if (nome === 'pep.finalizarSumarioAlta') {
    return {
      ...base,
      async preparar(e) {
        const medico = await profissionalDaCategoria(e, cenario !== 'recusa-nao-medico');
        const at = await atendimento(e, 'I');
        definirOperador(medico.login);
        const [v] = await e.consultar(
          'SELECT MAX(VERSAO) V FROM SGH_PEP_SUMARIO_ALTA WHERE HOSPITAL = ? AND ID_ATCABECATEND = ?',
          [hospital, at.id],
          { teto: 1 },
        );
        const dataHoraClinica = await horarioClinico(e);
        const ficha = await fichaPorNome(e, /Resumo de Alta/i);
        const sumario = {
          motivoInternacao: `Dor torácica ${MARCA_M23}`,
          diagnosticos: [{ cid: 'I20', descricao: 'Angina' }],
          procedimentos: [],
          medicamentosAlta: ['AAS 100 mg 1x ao dia'],
          alergias: [],
          encaminhamentos: ['Cardiologia'],
          plano: 'Retorno em 7 dias',
          condicaoAlta: 'Estável',
        };
        const texto = textoDoSumario(sumario);
        const conteudoXml = xmlDoAtestado(
          { codigo: ficha.codigo, nome: ficha.nome },
          ficha.componentes,
          texto,
        );
        const cab = await cabecalho(
          e,
          at,
          medico.cbo,
          SITUACAO_DOC.lancado,
          TIPO_ATO.atestado,
          dataHoraClinica,
        );
        entrada = {
          paciente: at.paciente,
          atendimento: at.id,
          cbo: medico.cbo,
          retratos: at.retratos,
          dataHoraClinica,
          modeloNome: ficha.nome,
          conteudoXml,
          documento: documentoAtestado(cab, texto, conteudoXml),
          hashConteudo: HASH,
          versao: (v?.['V'] === null || v?.['V'] === undefined ? 0 : Number(v['V'])) + 1,
          sumario: JSON.stringify(sumario),
          fhir: '{"resourceType":"Bundle"}',
          perfilFhir: 'br-core-1.6.1',
        };
        if (cenario === 'recusa-nao-medico') recusaEsperada = 'categoria-nao-permitida';
      },
      executar: rodar,
    };
  }

  if (nome === 'pep.anexarDocumento') {
    return {
      ...base,
      async preparar(e) {
        const prof = await profissionalDaCategoria(e, true);
        const at = await atendimento(e, 'E');
        definirOperador(prof.login);
        const [tp] = await e.consultar(
          "SELECT FIRST 1 ID FROM PRTIPODOCANEXO WHERE COALESCE(ATIVO, 'T') = 'T' ORDER BY ID",
          [],
          {
            teto: 1,
          },
        );
        const pdf = Buffer.from(
          `%PDF-1.4\n% ${MARCA_M23}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
          'latin1',
        );
        entrada = {
          paciente: at.paciente,
          atendimento: at.id,
          cbo: prof.cbo,
          retratos: at.retratos,
          dataHoraClinica: await horarioClinico(e),
          nome: `Exame externo ${MARCA_M23}`.slice(0, 40),
          ...(tp ? { tipoAnexo: Number(tp['ID']) } : {}),
          referencia: '2026-10-01',
          estacao: 'SGH-REPRODUCAO',
          conteudo: (cenario === 'recusa-vazio' ? Buffer.from('nao e pdf') : pdf).toString('base64'),
          hashConteudo: HASH,
        };
        if (cenario === 'recusa-vazio') recusaEsperada = 'arquivo-invalido';
      },
      executar: rodar,
    };
  }

  if (nome === 'pep.lancarExameExterno') {
    return {
      ...base,
      async preparar(e) {
        const prof = await profissionalDaCategoria(e, true);
        const at = await atendimento(e, 'I');
        definirOperador(prof.login);
        const dataHoraClinica = await horarioClinico(e);
        const realizado =
          cenario === 'recusa-futuro'
            ? `${Number(dataHoraClinica.slice(0, 4)) + 1}${dataHoraClinica.slice(4)}`
            : await horarioClinico(e, 60 * 24);
        const itens = [
          { elemento: `HEMOGLOBINA ${MARCA_M23}`, tipo: 'N' as const },
          { elemento: 'OBSERVACAO', tipo: 'T' as const },
        ];
        const rtf = rtfDoCampo(paragrafosDoTexto(`Hemoglobina: 13,5 g/dL (12,0 a 16,0)\n${MARCA_M23}`));
        const cab = await cabecalho(
          e,
          at,
          prof.cbo,
          SITUACAO_DOC.lancado,
          TIPO_ATO.resultadoLancado,
          dataHoraClinica,
        );
        entrada = {
          paciente: at.paciente,
          atendimento: at.id,
          cbo: prof.cbo,
          retratos: at.retratos,
          dataHoraClinica,
          realizadoEm: realizado,
          nomeExame: `HEMOGRAMA ${MARCA_M23}`,
          rtf,
          itens,
          documento: documentoExameExterno(cab, realizado, false, rtf, itens),
          hashConteudo: HASH,
        };
        if (cenario === 'recusa-futuro') recusaEsperada = 'horario-futuro';
      },
      executar: rodar,
    };
  }

  if (nome === 'pep.solicitarExame') {
    return {
      ...base,
      async preparar(e) {
        const medico = await profissionalDaCategoria(e, true);
        const at = await atendimentoComConta(e);
        definirOperador(medico.login);
        const lab = await e.consultar(
          "SELECT FIRST 20 ID, NOME FROM SITABPRO WHERE ATO = 15 AND COALESCE(SITUACAO, 'A') <> 'I' AND MATERIAL IS NOT NULL ORDER BY ID",
          [],
          { teto: 20 },
        );
        const exames = async () => {
          if (cenario === 'imagem')
            return (
              await e.consultar(
                "SELECT FIRST 1 ID FROM SITABPRO WHERE ATO IN (16, 24, 25) AND COALESCE(SITUACAO, 'A') <> 'I' ORDER BY ID",
                [],
                {
                  teto: 1,
                },
              )
            ).map((x) => numDoBanco(x['ID']));
          if (cenario === 'recusa-inativo')
            return (
              await e.consultar(
                "SELECT FIRST 1 ID FROM SITABPRO WHERE ATO = 15 AND SITUACAO = 'I' ORDER BY ID",
                [],
                { teto: 1 },
              )
            ).map((x) => numDoBanco(x['ID']));
          return lab.slice(0, cenario === 'kit-urgente' ? 3 : 1).map((x) => numDoBanco(x['ID']));
        };
        const ids = await exames();
        let kit: number | undefined;
        if (cenario === 'kit-urgente') {
          const [k] = await e.consultar(
            `SELECT FIRST 1 k.KIT FROM SIKITITE k JOIN SITABPRO t ON t.ATO = k.ATO AND t.CODALF = k.EXAME
              WHERE t.ATO = 15 AND COALESCE(t.SITUACAO, 'A') <> 'I' AND t.MATERIAL IS NOT NULL GROUP BY k.KIT HAVING COUNT(*) >= 3 ORDER BY k.KIT`,
            [],
            { teto: 1 },
          );
          if (k) {
            kit = Number(k['KIT']);
            const ks = await e.consultar(
              `SELECT FIRST 3 t.ID FROM SIKITITE k JOIN SITABPRO t ON t.ATO = k.ATO AND t.CODALF = k.EXAME
                WHERE k.KIT = ? AND COALESCE(t.SITUACAO, 'A') <> 'I' AND t.MATERIAL IS NOT NULL ORDER BY t.ID`,
              [kit],
              { teto: 3 },
            );
            ids.splice(0, ids.length, ...ks.map((x) => numDoBanco(x['ID'])));
          }
        }
        const dataHoraClinica = await horarioClinico(e);
        const cab = await cabecalho(
          e,
          at,
          medico.cbo,
          SITUACAO_DOC.solicitado,
          TIPO_ATO.pedidoExame,
          dataHoraClinica,
        );
        const urgente = cenario === 'kit-urgente';
        entrada = {
          paciente: at.paciente,
          atendimento: at.id,
          cbo: medico.cbo,
          retratos: at.retratos,
          dataHoraClinica,
          itens: ids.map((exame) => ({ exame, urgente, indicacao: `Investigação ${MARCA_M23}` })),
          ...(kit !== undefined ? { kit } : {}),
          documento: documentoPedidoExame(
            cab,
            '{{ORIGEM}}',
            ids.map((x, i) => ({
              controle: x,
              codigoAlfa: null,
              descricao: `EXAME ${x}`,
              material: null,
              seq: i + 1,
              ato: 'Exame',
              previsaoColeta: null,
              urgente,
              informacoes: MARCA_M23,
            })),
          ),
          hashConteudo: HASH,
        };
        if (cenario === 'recusa-inativo') recusaEsperada = 'exame-inativo';
      },
      executar: rodar,
    };
  }
  throw new Error(`Operação ${nome} sem reprodução.`);
}

/**
 * M49, etapa 2: a assinatura ICP-Brasil (SINTÉTICA) do documento recém-emitido, como o serviço grava: o certificado
 * vinculado, a prévia, a assinatura com a validação e o PDF, o evento "assinado" ICP e a trilha. Só tabelas SGH_.
 */
async function assinarIcpSintetico(
  e: Escritor,
  hospital: string,
  login: string,
  documento: number,
): Promise<void> {
  if (!Number.isSafeInteger(documento) || documento < 1)
    throw new Error('A emissão não devolveu o documento do novo.');
  const agora = new Date();
  const cert = await gravarCertificado(e, {
    hospital,
    usuario: login,
    midia: 'nuvem',
    provedor: 'simulador',
    idTipoCertificado: null,
    serie: `5a1e${documento.toString(16)}`,
    emissorHash: 'a'.repeat(64),
    tipoIcp: 'A3',
    validoDe: agora,
    validoAte: new Date(agora.getTime() + 365 * 86_400_000),
    cpfMascarado: '***.000.001-**',
    certificadoDer: 'MIIBsintetico',
  });
  const pv = await gravarPreviaAssinatura(e, {
    hospital,
    documento,
    usuario: login,
    certificado: cert.id,
    politicaIcp: 'AD-RT',
    hashPdf: 'e'.repeat(64),
    chaveS3: `rede/${hospital}/documentos/receita-controlada/sintetico/via-1.pdf`,
    versaoS3: 'v1',
    codigo: `SINTETICOM49${String(documento).padStart(12, '0')}`,
    assinarEm: agora.toISOString(),
  });
  const a = await gravarAssinaturaIcp(e, {
    hospital,
    origem: 'documento',
    documento,
    hash: 'f'.repeat(64),
    formato: 'pades',
    politicaIcp: 'AD-RT',
    midia: 'nuvem',
    provedor: 'simulador',
    certificado: cert.id,
    usuario: login,
    estado: 'assinada',
    tentativas: 0,
    falha: null,
    proximaEm: null,
    assinatura: 'QUJD',
    carimboToken: 'REVG',
    carimboEm: agora,
    carimboSerie: '0a0b',
  });
  await gravarValidacaoIcp(e, {
    assinatura: a.id,
    momento: 'assinar',
    resultado: 'valida',
    cadeia: true,
    vigencia: true,
    revogacao: true,
    cpf: true,
    assinaturaConfere: true,
    carimbo: true,
    motivos: [],
    usuario: login,
    em: agora,
  });
  await gravarAssinaturaPdf(e, { assinatura: a.id, previa: pv.id });
  await gravarEventoAssinadoIcp(e, { hospital, usuarioLegado: login }, documento);
}
