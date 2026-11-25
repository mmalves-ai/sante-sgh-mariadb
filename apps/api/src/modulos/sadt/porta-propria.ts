// Porta do SADT sobre o banco do cliente (M26), pelo @sgh/nucleo: leituras somente leitura nas tabelas do diagnóstico
// (requisicao_exame, exame_item, exame, setor_diagnostico, resultado_exame, amostra_biologica e o rastreio,
// aviso_valor_critico e as tentativas, regra_valor_critico, emissao_laudo, visualizacao_resultado_exame) e gravações
// pelo Executor, com a trilha na mesma transação. Toda leitura filtra o estabelecimento da sessão e os excluídos; o
// catálogo de exames, de analitos e de modalidades é da rede inteira (sem estabelecimento).
// Melhoria: o estado do exame vem da situação do item pedido e do rastreio da amostra (vocabulario-banco.ts), nunca de
// marcas S/N; a conferência da pulseira fica no evento da amostra (com a estação); a passagem de estado da amostra
// confere o estado relido sob trava (FOR UPDATE) e a versão; o aviso de valor crítico guarda cada tentativa de contato
// com o canal e o nível de escalonamento; a segunda via do laudo exige o motivo do cadastro (motivo_reimpressao); a faixa crítica é uma regra com vigência (a anterior é encerrada, não apagada).
// Melhoria: a regra de valor crítico do estabelecimento sobrepõe a da rede (a leitura mostra só a efetiva; a edição na
// unidade cria a regra da unidade e não mexe na da rede, que segue para as outras unidades).
// Melhoria: o aviso crítico vai ao solicitante da requisição (usuário ativo, pelo vínculo do profissional), nunca ao
// executante do atendimento de laboratório; a amostra vigente do exame ignora a rejeitada/cancelada (a recoleta volta
// à lista de coleta e o exame volta a "solicitado"); a leitura do resultado grava só a primeira abertura.
// Melhoria: toda inclusão passa por tx.incluir (auditoria e escritas da trilha); cada gravação leva o nome do evento
// da tela como operação e a chave de idempotência da requisição, quando a tela a manda.
// F2.4: a bancada (digitação com faixa e valor crítico vigentes, conferência com as versões retificadas, fila de
// liberação), o laudo para emitir, a recepção do setor (atendimentos do dia, atendimento para lançamento), o orçamento do
// diagnóstico (orcamento_particular com itens de exame) e a conversão, o catálogo de apoio, os parâmetros `sadt.*`, os
// indicadores agregados no banco, os laudos publicados no portal (liberacao_resultado_portal, a leitura no portal em
// acesso_resultado_portal) e os autocadastros de médicos externos (pedido_vinculo_profissional_externo) com a decisão.
// O portal de resultados lê e grava o protocolo do paciente (protocolo_acesso_portal) e a credencial do médico externo
// (pedido e conta do portal). Pendência (a tela recebe o motivo, nada em silêncio): as operações do executor
// (OPERACOES_SADT_PENDENTES: contrato novo da tela, pedido p-sadt).
import { comCalculo, lerFormulasDoExame, lerTextosPadraoDoExame } from './aplicacao/formulas-leitura.js';
import { lerBancadasDoMapa } from './aplicacao/mapa-trabalho-propria.js';
import {
  type AmostraDetalhe,
  type AvisoCritico,
  type ColetaGrupo,
  type EstadoAmostra,
  type ElementoDigitacao,
  type ExameSadt,
  type ItemLiberacao,
  type LaudoPortal,
  NIVEIS_ESCALONAMENTO,
  type OrcamentoLido,
  type PacienteSadt,
  type RequisicaoLida,
  rotuloEstadoAmostra,
  rotuloEstadoExame,
  SETORES_SADT,
  type SetorSadt,
  type ValorConferencia,
  type ValorCriticoLido,
} from '@sgh/contratos';
import {
  type ContextoNucleo,
  type ContextoOperacao,
  definirOperacao,
  ErroOperacao,
  erroConflitoVersao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  recusa,
  type ResultadoOperacao,
  type TxOperacao,
} from '@sgh/nucleo';
import {
  alvosDoAviso,
  avisoDoAlvo,
  dataDaReferencia,
  distribuirPorBancada,
  emissaoSuperada,
  numeroDoLaudo,
  type RegraCriticoCandidata,
  SEQUENCIA_NUMERO_LAUDO,
} from '@sgh/dominio-sadt';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type LiberacaoGravacao, portaIndisponivel, type TrilhaDaGravacao } from '../exames/public-api.js';
import { FUSO_PADRAO, instanteCivil, relogioNoFuso } from '../exames/relogio.js';
import { OPERACOES_SADT_DIRETAS, OPERACOES_SADT_PENDENTES } from './operacoes.js';
import {
  type AcessoPortalLido,
  type ApoioSadtLido,
  type AtendimentoParaLancamento,
  type AutocadastroPortalLido,
  type ContextoSadt,
  type GravadorSghSadt,
  type LaudoParaEmitir,
  type LaudoPortalLido,
  METODOS_PORTA_SADT,
  type PortaSadt,
  type ResultadoParaDigitacaoLido,
  type VinculoDaSessao,
} from './porta.js';
import {
  atoDoExame,
  estadoDaAmostra,
  estadoDoItem,
  SITUACAO_DA_AMOSTRA,
  SITUACOES_DO_FILTRO,
  setorDoTipo,
  siglasDoAto,
  TIPOS_DO_SETOR,
} from './vocabulario-banco.js';
import { conferirPostoDaColeta } from './aplicacao/posto-coleta-propria.js';

/** O mínimo do núcleo que a porta usa. */
export type NucleoSadt = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

export const TETO_EXAMES_SADT = 500;
const TABELAS_GRAVACAO = [
  'amostra_biologica',
  'amostra_biologica_exame',
  'amostra_biologica_evento',
  'exame_item',
  'regra_valor_critico',
  'aviso_valor_critico',
  'aviso_valor_critico_tentativa',
  'visualizacao_resultado_exame',
  'emissao_laudo',
  'emissao_laudo_exame',
  'sequencia_negocio',
  'orcamento_particular',
  'pedido_vinculo_profissional_externo',
  'conta_portal_profissional_externo',
  'protocolo_acesso_portal',
  'liberacao_resultado_portal',
  'acesso_resultado_portal',
] as const;

const pendente = (o: string): ErroOperacao =>
  new ErroOperacao(
    409,
    'modelo-pendente',
    'Recurso ainda não disponível no banco',
    `${o.slice(0, 1).toUpperCase()}${o.slice(1)} ainda não está disponível neste banco: a tela fica em consulta.`,
  );

type Linha = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/**
 * O acesso ao portal tem duas origens: o protocolo do paciente (protocolo_acesso_portal, id positivo) e o médico
 * externo (id negativo): a conta do portal (-id da conta) ou, antes da aprovação, o autocadastro (-(BASE + id do
 * pedido)). A tentativa e a releitura voltam pela mesma chave.
 */
const BASE_PEDIDO_PORTAL = 1_000_000_000_000;
type ChaveAcessoPortal = { tipo: 'protocolo' | 'conta' | 'pedido'; id: number };
export function chaveAcessoPortal(id: number): ChaveAcessoPortal {
  if (id > 0) return { tipo: 'protocolo', id };
  return -id > BASE_PEDIDO_PORTAL
    ? { tipo: 'pedido', id: -id - BASE_PEDIDO_PORTAL }
    : { tipo: 'conta', id: -id };
}
/** conta_portal_profissional_externo.situacao → a situação do acesso que o portal confere. */
const SITUACAO_ACESSO_CONTA: Readonly<Record<string, string>> = {
  ativa: 'ativo',
  bloqueada: 'bloqueado',
  suspensa: 'bloqueado',
  encerrada: 'encerrado',
  pendente: 'pendente',
};
/** pedido_vinculo_profissional_externo.situacao (sem conta) → a situação do acesso. */
const SITUACAO_ACESSO_PEDIDO: Readonly<Record<string, string>> = {
  pendente: 'pendente',
  em_conferencia: 'pendente',
  recusado: 'recusado',
  aprovado: 'pendente',
};
const SQL_ACESSO_MEDICO = `
  SELECT pv.id AS pedido, pv.nome, pv.situacao AS situacao_pedido, pv.resumo_senha AS senha_pedido,
         pv.segredo_segundo_fator_cifrado AS fator_pedido, pv.tentativas_falhas AS tentativas_pedido,
         pv.bloqueado_ate AS bloqueado_pedido, cc.sigla AS conselho, uf.sigla AS uf, pv.numero_conselho,
         cp.id AS conta, cp.situacao AS situacao_conta, cp.profissional_id, cp.resumo_senha AS senha_conta,
         cp.segredo_segundo_fator_cifrado AS fator_conta, cp.tentativas_falhas, cp.bloqueada_ate
    FROM pedido_vinculo_profissional_externo pv
    JOIN conselho_classe cc ON cc.id = pv.conselho_classe_id
    JOIN unidade_federativa uf ON uf.id = pv.conselho_unidade_federativa_id
    LEFT JOIN conta_portal_profissional_externo cp ON cp.id = pv.conta_portal_profissional_externo_id AND cp.excluido_em IS NULL
   WHERE pv.estabelecimento_id = ? AND pv.excluido_em IS NULL AND pv.situacao <> 'cancelado'`;
function acessoDoMedicoLido(r: Linha): AcessoPortalLido {
  const conta = nn(r['conta']);
  const base = {
    perfil: 'medicoExterno' as const,
    paciente: null,
    reg: null,
    conselho: texto(r['conselho']),
    uf: texto(r['uf']),
    numero: texto(r['numero_conselho']),
    nome: texto(r['nome']),
  };
  if (conta !== null)
    return {
      ...base,
      id: -conta,
      solicitante: nn(r['profissional_id']),
      senhaResumo:
        r['senha_conta'] === null || r['senha_conta'] === undefined ? null : texto(r['senha_conta']),
      segundoFator:
        r['fator_conta'] === null || r['fator_conta'] === undefined ? null : texto(r['fator_conta']),
      situacao: SITUACAO_ACESSO_CONTA[texto(r['situacao_conta'])] ?? 'encerrado',
      tentativas: n(r['tentativas_falhas']),
      bloqueadoAte: r['bloqueada_ate'] ? new Date(r['bloqueada_ate'] as string) : null,
    };
  return {
    ...base,
    id: -(BASE_PEDIDO_PORTAL + n(r['pedido'])),
    solicitante: null,
    senhaResumo:
      r['senha_pedido'] === null || r['senha_pedido'] === undefined ? null : texto(r['senha_pedido']),
    segundoFator:
      r['fator_pedido'] === null || r['fator_pedido'] === undefined ? null : texto(r['fator_pedido']),
    situacao: SITUACAO_ACESSO_PEDIDO[texto(r['situacao_pedido'])] ?? 'recusado',
    // O autocadastro conta as falhas e bloqueia como a conta: a senha do pedido passa à conta na aprovação.
    tentativas: n(r['tentativas_pedido']),
    bloqueadoAte: r['bloqueado_pedido'] ? new Date(r['bloqueado_pedido'] as string) : null,
  };
}
const SQL_ACESSO_PROTOCOLO = `
  SELECT pa.id, pa.paciente_id, pa.atendimento_id, pa.situacao, pa.tentativas_falhas, pa.bloqueado_ate, pf.nome
    FROM protocolo_acesso_portal pa
    JOIN paciente p ON p.id = pa.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
   WHERE pa.estabelecimento_id = ? AND pa.excluido_em IS NULL`;
function acessoDoProtocoloLido(r: Linha): AcessoPortalLido {
  return {
    id: n(r['id']),
    perfil: 'paciente',
    paciente: n(r['paciente_id']),
    reg: n(r['atendimento_id']),
    conselho: null,
    uf: null,
    numero: null,
    solicitante: null,
    nome: texto(r['nome']),
    senhaResumo: null,
    segundoFator: null,
    situacao: texto(r['situacao']),
    tentativas: n(r['tentativas_falhas']),
    bloqueadoAte: r['bloqueado_ate'] ? new Date(r['bloqueado_ate'] as string) : null,
  };
}
const verdadeiro = (v: unknown) => v === true || v === 1 || v === '1' || v === 1n;
const lista = (k: number) => Array.from({ length: k }, () => '?').join(', ');
/** DATETIME do banco → "AAAA-MM-DDTHH:MM:SS". */
const instante = (v: unknown): string =>
  v instanceof Date ? v.toISOString().slice(0, 19) : v ? String(v).replace(' ', 'T').slice(0, 19) : '';
const dataIso = (v: unknown): string | null => (v ? instante(v).slice(0, 10) : null);
const idadeAnos = (nasc: string | null, hoje: string): number | null => {
  if (!nasc) return null;
  const [a, m, d] = nasc.split('-').map(Number) as [number, number, number];
  const [ha, hm, hd] = hoje.split('-').map(Number) as [number, number, number];
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
};

const SQL_EXAME = `
  SELECT ei.id, ei.sequencia, ei.situacao, ei.urgente, ei.versao, ei.criado_em, ei.alterado_em, ei.emitido_em,
         ei.previsto_em, r.id AS requisicao, r.numero AS requisicao_numero, r.atendimento_id, r.paciente_id,
         r.solicitado_em, r.tipo_solicitacao, r.prioridade, r.unidade_assistencial_id, sd.tipo AS tipo_setor,
         e.id AS exame_id, e.codigo AS exame_codigo, e.sigla, e.nome AS exame_nome, mi.sigla_padrao,
         pf.nome AS paciente_nome, pf.data_nascimento, sx.sigla AS sexo, p.numero_prontuario,
         a.numero AS atendimento_numero,
         EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = a.id) AS internado,
         COALESCE(prof.nome_exibicao, pfp.nome) AS solicitante,
         mb.descricao AS material, rc.id AS recipiente_id, rc.descricao AS recipiente,
         ed.id AS especialidade_id, ed.descricao AS especialidade,
         am.id AS amostra_id, am.codigo_barras, am.situacao AS amostra_situacao, am.coletada_em,
         COALESCE(am.alterado_em, am.criado_em) AS amostra_em,
         EXISTS (SELECT 1 FROM visualizacao_resultado_exame v JOIN resultado_exame re ON re.id = v.resultado_exame_id
                  WHERE re.exame_item_id = ei.id) AS visualizado,
         EXISTS (SELECT 1 FROM resultado_exame re WHERE re.exame_item_id = ei.id AND re.critico = TRUE
                    AND re.excluido_em IS NULL) AS critico
    FROM exame_item ei
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
    JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
    JOIN exame e ON e.id = ei.exame_id
    LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
    JOIN paciente p ON p.id = r.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    JOIN atendimento a ON a.id = r.atendimento_id
    LEFT JOIN profissional prof ON prof.id = r.solicitante_profissional_id
    LEFT JOIN pessoa_fisica pfp ON pfp.id = prof.pessoa_fisica_id
    LEFT JOIN material_biologico mb ON mb.id = ei.material_biologico_id
    LEFT JOIN recipiente_coleta rc ON rc.id = ei.recipiente_coleta_id
    LEFT JOIN especialidade_diagnostica ed ON ed.id = e.especialidade_diagnostica_id
    LEFT JOIN amostra_biologica am ON am.id = (
         SELECT abe.amostra_biologica_id FROM amostra_biologica_exame abe
           JOIN amostra_biologica x ON x.id = abe.amostra_biologica_id
          WHERE abe.exame_item_id = ei.id AND abe.excluido_em IS NULL AND x.excluido_em IS NULL
          ORDER BY x.situacao IN ('rejeitada', 'cancelada', 'descartada'), abe.amostra_biologica_id DESC LIMIT 1)
   WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL
     AND sd.tipo IN ('laboratorio', 'imagem', 'metodos_graficos', 'endoscopia')`;

function exameDe(r: Linha, hoje: string): ExameSadt {
  const ato = atoDoExame(
    texto(r['tipo_setor']),
    r['sigla_padrao'] === null ? null : texto(r['sigla_padrao']),
  );
  const amostra = r['amostra_id'] === null ? null : estadoDaAmostra(texto(r['amostra_situacao']));
  const estado = estadoDoItem({
    situacao: texto(r['situacao']),
    emitido: r['emitido_em'] !== null,
    visualizado: verdadeiro(r['visualizado']),
    amostra,
  });
  const nasc = dataIso(r['data_nascimento']);
  const sexo = texto(r['sexo']).toUpperCase();
  const tipo = texto(r['tipo_solicitacao']);
  return {
    id: n(r['id']),
    chave: {
      data: dataIso(r['solicitado_em']) ?? hoje,
      reg: n(r['atendimento_id']),
      conta: n(r['requisicao']),
      atend: verdadeiro(r['internado']) ? 'I' : 'E',
      ato,
      exame: (texto(r['sigla']) || texto(r['exame_codigo'])).slice(0, 4),
      sequencia: n(r['sequencia']),
    },
    versao: instante(r['alterado_em'] ?? r['criado_em']) || null,
    paciente: {
      id: n(r['paciente_id']),
      prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
      nome: texto(r['paciente_nome']),
      sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
      idadeAnos: idadeAnos(nasc, hoje),
      nascimento: nasc,
    },
    atendimento: {
      cabecalho: texto(r['atendimento_numero']),
      reg: n(r['atendimento_id']),
      tipo: verdadeiro(r['internado']) ? 'I' : 'E',
      unidade: nn(r['unidade_assistencial_id']),
      leito: null,
    },
    setor: setorDoTipo(texto(r['tipo_setor'])) ?? 'laboratorio',
    ato,
    atoRotulo: rotuloDoAto(ato),
    exame: { id: n(r['exame_id']), codigo: texto(r['exame_codigo']), nome: texto(r['exame_nome']) },
    estado,
    estadoRotulo: rotuloEstadoExame(estado),
    urgente: verdadeiro(r['urgente']) || texto(r['prioridade']) !== 'rotina',
    origem:
      tipo === 'pedido_prontuario'
        ? 'pedidoProntuario'
        : tipo === 'lancado_no_setor'
          ? 'lancadoNoSetor'
          : 'outro',
    solicitante: texto(r['solicitante']),
    pedidoEm: instante(r['solicitado_em']).slice(0, 16) || null,
    previsaoColeta: r['previsto_em'] === null ? null : instante(r['previsto_em']).slice(0, 16),
    material: r['material'] === null ? null : texto(r['material']),
    recipiente:
      r['recipiente_id'] === null ? null : { codigo: n(r['recipiente_id']), nome: texto(r['recipiente']) },
    especialidade:
      r['especialidade_id'] === null
        ? null
        : { codigo: n(r['especialidade_id']), nome: texto(r['especialidade']) },
    amostra:
      amostra === null
        ? null
        : {
            id: n(r['amostra_id']),
            codigo: texto(r['codigo_barras']),
            estado: amostra,
            rotulo: rotuloEstadoAmostra(amostra),
            em: instante(r['amostra_em']),
          },
    critico: verdadeiro(r['critico']),
  };
}

const ROTULOS_ATO: Readonly<Record<number, string>> = {
  15: 'Patologia clínica',
  16: 'Radiologia',
  21: 'Endoscopia',
  24: 'Ultrassonografia',
  25: 'Tomografia',
  26: 'Ressonância magnética',
  27: 'Ecocardiograma com Doppler',
  42: 'Outros exames de imagem',
  90: 'Métodos gráficos',
};
const rotuloDoAto = (ato: number) => ROTULOS_ATO[ato] ?? 'Outro';

const SQL_AMOSTRA = `
  SELECT am.id, am.codigo_barras, am.situacao, am.versao, am.paciente_id_req AS paciente_id, rc.descricao AS recipiente,
         pf.nome AS paciente_nome, pf.data_nascimento, sx.sigla AS sexo, p.numero_prontuario
    FROM (SELECT x.*, r.paciente_id AS paciente_id_req FROM amostra_biologica x
            JOIN requisicao_exame r ON r.id = x.requisicao_exame_id) am
    JOIN paciente p ON p.id = am.paciente_id_req
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    LEFT JOIN recipiente_coleta rc ON rc.id = am.recipiente_coleta_id
   WHERE am.estabelecimento_id = ? AND am.excluido_em IS NULL`;

const TETO_REQUISICOES = 200;
const TETO_ORCAMENTOS = 500;
const TETO_CATALOGO = 5000;
const TETO_PORTAL = 200;
/** Os tipos de setor do diagnóstico que o SADT atende. */
const TIPOS_SADT: readonly string[] = ['laboratorio', 'imagem', 'metodos_graficos', 'endoscopia'];
/** conta_portal_profissional_externo.situacao → a situação da conta na tela de autocadastros. */
const SITUACAO_DA_CONTA: Readonly<Record<string, string>> = {
  pendente: 'pendente',
  ativa: 'ativo',
  bloqueada: 'bloqueado',
  suspensa: 'bloqueado',
  encerrada: 'encerrado',
};

/** A primeira linha de cada chave (a consulta já vem ordenada pela precedência). */
function primeiraPor(ls: readonly Linha[], campo: string): Map<number, Linha> {
  const m = new Map<number, Linha>();
  for (const r of ls) if (!m.has(n(r[campo]))) m.set(n(r[campo]), r);
  return m;
}
const rotuloDoSetor = (s: SetorSadt) => SETORES_SADT.find((x) => x.codigo === s)?.rotulo ?? '';
/** As situações do laudo que valem como laudo oficial (assinado; emitido ou retificado depois da assinatura). */
const LAUDO_ASSINADO = ['assinado', 'emitido', 'retificado'];
/** O texto do laudo: o laudo assinado; sem ele, o texto do resultado; e a conclusão. */
const linhasDoLaudo = (d: Linha | undefined): string[] =>
  [d?.['laudo'] ?? d?.['texto_resultado'], d?.['conclusao']]
    .filter((x) => x !== null && x !== undefined && texto(x) !== '')
    .map(texto);
/** O número de negócio (texto com prefixo) como número da tela. */
const numeroDeNegocio = (v: unknown) => Number(texto(v).replace(/\D/g, '')) || 0;

function pacienteDe(r: Linha, hoje: string): PacienteSadt {
  const nasc = dataIso(r['data_nascimento']);
  const sexo = texto(r['sexo']).toUpperCase();
  return {
    id: n(r['paciente_id']),
    prontuario: numeroDeNegocio(r['numero_prontuario']),
    nome: texto(r['paciente_nome']),
    sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
    idadeAnos: idadeAnos(nasc, hoje),
    nascimento: nasc,
  };
}

/** O atendimento para o lançamento no setor, com a requisição aberta no setor e as versões (trava otimista). */
const SQL_ATENDIMENTO_LANCAMENTO = `
  SELECT a.id, a.numero, a.entrada_em, a.versao, fp.id AS fp_id, fp.nome AS fp_nome, p.id AS paciente_id,
         p.versao AS paciente_versao, p.numero_prontuario, pf.nome AS paciente_nome, pf.data_nascimento, sx.sigla AS sexo,
         EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = a.id) AS internado,
         (SELECT q.id FROM requisicao_exame q WHERE q.atendimento_id = a.id AND q.estabelecimento_id = a.estabelecimento_id
             AND q.excluido_em IS NULL AND q.situacao IN ('solicitada', 'em_andamento') AND q.tipo_solicitacao = 'lancado_no_setor'
           ORDER BY q.id DESC LIMIT 1) AS conta_id,
         (SELECT q.numero FROM requisicao_exame q WHERE q.atendimento_id = a.id AND q.estabelecimento_id = a.estabelecimento_id
             AND q.excluido_em IS NULL AND q.situacao IN ('solicitada', 'em_andamento') AND q.tipo_solicitacao = 'lancado_no_setor'
           ORDER BY q.id DESC LIMIT 1) AS conta_numero,
         (SELECT COUNT(*) FROM exame_item ei JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
           WHERE q.atendimento_id = a.id AND q.excluido_em IS NULL AND ei.excluido_em IS NULL
             AND ei.situacao NOT IN ('cancelado', 'recusado')) AS exames
    FROM atendimento a
    JOIN paciente p ON p.id = a.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN sexo sx ON sx.id = pf.sexo_id
    JOIN fonte_pagadora fp ON fp.id = a.fonte_pagadora_id
   WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL AND a.situacao <> 'cancelado'`;

function atendimentoDe(r: Linha, hoje: string): AtendimentoParaLancamento {
  return {
    atendimento: n(r['id']),
    paciente: pacienteDe(r, hoje),
    atend: verdadeiro(r['internado']) ? 'I' : 'E',
    reg: n(r['id']),
    convenio: { codigo: n(r['fp_id']), nome: texto(r['fp_nome']) },
    conta:
      r['conta_id'] === null ? null : { id: n(r['conta_id']), numero: numeroDeNegocio(r['conta_numero']) },
    retratos: { htAtendimento: n(r['versao']), htPaciente: n(r['paciente_versao']) },
  };
}

/**
 * O orçamento do diagnóstico é o orçamento particular com itens de exame (o item liga ao exame pelo item faturável
 * do catálogo ou, sem ele, pelo código do exame na descrição). O ato é o do primeiro exame identificado. O item que não
 * casa com exame nenhum continua na lista (descrição e valor do próprio item, código do exame vazio = não identificado),
 * para a soma dos itens bater com o total.
 */
const SQL_ORCAMENTO = `
  SELECT op.id, op.data_orcamento, op.validade_ate, op.situacao, op.valor_total, op.paciente_id, op.atendimento_id,
         op.realizado_em, op.nome_interessado, pf.nome AS paciente_nome, fp.id AS fp_id, fp.nome AS fp_nome
    FROM orcamento_particular op
    LEFT JOIN paciente p ON p.id = op.paciente_id
    LEFT JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN fonte_pagadora fp ON fp.id = op.fonte_pagadora_id
   WHERE op.estabelecimento_id = ? AND op.excluido_em IS NULL AND op.situacao NOT IN ('cancelado', 'recusado')
     AND EXISTS (SELECT 1 FROM orcamento_particular_item oi WHERE oi.orcamento_particular_id = op.id
                    AND oi.tipo_item = 'exame' AND oi.excluido_em IS NULL)`;

async function orcamentosLidos(l: Leitor, ls: readonly Linha[], hoje: string): Promise<OrcamentoLido[]> {
  if (ls.length === 0) return [];
  const ids = ls.map((r) => n(r['id']));
  const itens = new Map<number, { exame: string; nome: string; valor: number; ato: number }[]>();
  const vistos = new Set<string>();
  for (const r of await l.consultar(
    `SELECT oi.orcamento_particular_id, oi.sequencia, oi.valor_total, COALESCE(oi.descricao, itf.descricao) AS descricao,
            e.id AS exame_id, e.codigo, e.nome, e.tipo_servico, mi.sigla_padrao
       FROM orcamento_particular_item oi
       LEFT JOIN item_faturavel itf ON itf.id = oi.item_faturavel_id
       LEFT JOIN exame e ON (e.id = oi.exame_id OR (oi.exame_id IS NULL AND (e.item_faturavel_id = oi.item_faturavel_id
                   OR (oi.item_faturavel_id IS NULL AND e.codigo = oi.descricao))))
                   AND e.excluido_em IS NULL
       LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
      WHERE oi.tipo_item = 'exame' AND oi.excluido_em IS NULL AND oi.orcamento_particular_id IN (${lista(ids.length)})
      ORDER BY oi.orcamento_particular_id, oi.sequencia, e.id`,
    ids,
    { teto: 20_000 },
  )) {
    const k = `${n(r['orcamento_particular_id'])}:${n(r['sequencia'])}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    const servico = texto(r['tipo_servico']);
    const tipo = servico === 'metodo_grafico' ? 'metodos_graficos' : servico;
    const o = n(r['orcamento_particular_id']);
    const identificado = r['exame_id'] !== null;
    itens.set(o, [
      ...(itens.get(o) ?? []),
      identificado
        ? {
            exame: texto(r['codigo']),
            nome: texto(r['nome']),
            valor: n(r['valor_total']),
            ato: atoDoExame(tipo, r['sigla_padrao'] === null ? null : texto(r['sigla_padrao'])),
          }
        : { exame: '', nome: texto(r['descricao']), valor: n(r['valor_total']), ato: 0 },
    ]);
  }
  return ls.map((r) => {
    const is = itens.get(n(r['id'])) ?? [];
    const sit = texto(r['situacao']);
    const validade = dataIso(r['validade_ate']) ?? '';
    const ato = is.find((x) => x.exame !== '')?.ato ?? 0;
    return {
      id: n(r['id']),
      nome: texto(r['nome_interessado']) || texto(r['paciente_nome']),
      paciente: nn(r['paciente_id']),
      convenio: { codigo: n(r['fp_id']), nome: texto(r['fp_nome']) },
      ato,
      atoRotulo: rotuloDoAto(ato),
      data: dataIso(r['data_orcamento']) ?? '',
      validade,
      situacao:
        sit === 'realizado' ? 'convertido' : sit === 'expirado' || validade < hoje ? 'vencido' : 'aberto',
      itens: is.map(({ exame, nome, valor }) => ({ exame, nome, valor })),
      total: n(r['valor_total']),
      convertidoEm:
        sit === 'realizado' && r['atendimento_id'] !== null
          ? { atendimento: n(r['atendimento_id']), em: dataIso(r['realizado_em']) ?? '' }
          : null,
    };
  });
}

/** Os valores dos resultados (resultado_analito), com a referência guardada na digitação e o sentido do desvio. */
async function valoresDosResultados(
  l: Leitor,
  ids: readonly number[],
): Promise<Map<number, ValorConferencia[]>> {
  const m = new Map<number, ValorConferencia[]>();
  if (ids.length === 0) return m;
  for (const r of await l.consultar(
    `SELECT ra.resultado_exame_id, an.nome, ra.valor_numerico, COALESCE(ra.valor_texto, rp.descricao) AS alfa, ur.simbolo,
            ra.referencia_minimo, ra.referencia_maximo, ra.referencia_texto, ra.interpretacao, ra.critico
       FROM resultado_analito ra JOIN analito an ON an.id = ra.analito_id
       LEFT JOIN unidade_resultado ur ON ur.id = COALESCE(ra.unidade_resultado_id, an.unidade_resultado_id)
       LEFT JOIN resposta_padrao rp ON rp.id = ra.resposta_padrao_id
      WHERE ra.excluido_em IS NULL AND ra.resultado_exame_id IN (${lista(ids.length)})
      ORDER BY ra.resultado_exame_id, ra.sequencia`,
    ids,
    { teto: 20_000 },
  )) {
    const numero = nn(r['valor_numerico']);
    const min = nn(r['referencia_minimo']);
    const max = nn(r['referencia_maximo']);
    const interp = texto(r['interpretacao']);
    const fora =
      interp === 'baixo' || interp === 'critico_baixo'
        ? ('abaixo' as const)
        : interp === 'alto' || interp === 'critico_alto'
          ? ('acima' as const)
          : numero !== null && min !== null && numero < min
            ? ('abaixo' as const)
            : numero !== null && max !== null && numero > max
              ? ('acima' as const)
              : null;
    const referencia =
      r['referencia_texto'] !== null
        ? texto(r['referencia_texto'])
        : min !== null && max !== null
          ? `${min} a ${max}`
          : min !== null
            ? `≥ ${min}`
            : max !== null
              ? `≤ ${max}`
              : null;
    const k = n(r['resultado_exame_id']);
    m.set(k, [
      ...(m.get(k) ?? []),
      {
        elemento: texto(r['nome']),
        valor: r['alfa'] !== null ? texto(r['alfa']) : numero === null ? '' : String(numero),
        numero,
        unidade: r['simbolo'] === null ? null : texto(r['simbolo']),
        referencia,
        foraDaFaixa: fora,
        critico: verdadeiro(r['critico']),
      },
    ]);
  }
  return m;
}

/** O item da conferência: o resultado do exame pedido, quem digitou, os valores e as versões retificadas. */
async function itensDeLiberacao(l: Leitor, exames: readonly ExameSadt[]): Promise<ItemLiberacao[]> {
  if (exames.length === 0) return [];
  const rs = await l.consultar(
    `SELECT re.id, re.exame_item_id, re.digitado_em, re.critico, COALESCE(u.login, '') AS por
       FROM resultado_exame re LEFT JOIN usuario u ON u.id = re.digitado_por_usuario_id
      WHERE re.excluido_em IS NULL AND re.exame_item_id IN (${lista(exames.length)})`,
    exames.map((x) => x.id),
    { teto: exames.length },
  );
  const porItem = new Map(rs.map((r) => [n(r['exame_item_id']), r]));
  const ids = rs.map((r) => n(r['id']));
  const valores = await valoresDosResultados(l, ids);
  const versoes = new Map<number, ItemLiberacao['versoes']>();
  if (ids.length)
    for (const v of await l.consultar(
      `SELECT v.resultado_exame_id, v.numero_versao, v.ocorrido_em, v.motivo,
              (SELECT COUNT(*) FROM visualizacao_resultado_exame x
                WHERE x.resultado_exame_id = v.resultado_exame_id AND x.visualizado_em < v.ocorrido_em) AS vistos
         FROM resultado_exame_versao v WHERE v.resultado_exame_id IN (${lista(ids.length)})
        ORDER BY v.resultado_exame_id, v.numero_versao`,
      ids,
      { teto: 5000 },
    )) {
      const k = n(v['resultado_exame_id']);
      versoes.set(k, [
        ...(versoes.get(k) ?? []),
        {
          versao: n(v['numero_versao']),
          em: instante(v['ocorrido_em']),
          motivo: v['motivo'] === null ? null : texto(v['motivo']),
          viramAntes: n(v['vistos']),
        },
      ]);
    }
  return exames.map((exame) => {
    const r = porItem.get(exame.id);
    const vs = r ? (valores.get(n(r['id'])) ?? []) : [];
    return {
      exame,
      valores: vs,
      digitadoEm: r ? dataIso(r['digitado_em']) : null,
      digitadoPor: r && texto(r['por']) ? texto(r['por']) : null,
      critico: (r ? verdadeiro(r['critico']) : false) || vs.some((v) => v.critico),
      versoes: (r ? versoes.get(n(r['id'])) : undefined) ?? [],
    };
  });
}

/** O laudo publicado no portal: vigente (não retirado, dentro do prazo) e do resultado liberado deste estabelecimento. */
const SQL_LAUDO_PORTAL = `
  SELECT lp.id, lp.liberado_em AS publicado_em, lp.primeira_visualizacao_em, re.id AS resultado, re.liberado_em,
         re.texto_resultado, re.conclusao, ei.id AS item, e.nome, sd.tipo, mi.sigla_padrao, r.solicitado_em, r.paciente_id,
         r.atendimento_id, r.solicitante_profissional_id, pf.nome AS paciente_nome, ld.texto AS laudo
    FROM liberacao_resultado_portal lp
    JOIN resultado_exame re ON re.id = lp.resultado_exame_id AND re.excluido_em IS NULL AND re.situacao IN ('liberado', 'retificado')
    JOIN exame_item ei ON ei.id = re.exame_item_id AND ei.excluido_em IS NULL
    JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id AND r.excluido_em IS NULL AND r.estabelecimento_id = lp.estabelecimento_id
    JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
    JOIN exame e ON e.id = ei.exame_id
    LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
    JOIN paciente p ON p.id = r.paciente_id
    JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
    LEFT JOIN laudo_diagnostico ld ON ld.exame_item_id = ei.id AND ld.excluido_em IS NULL
                                 AND ld.situacao IN ('assinado', 'emitido', 'retificado')
   WHERE lp.estabelecimento_id = ? AND lp.situacao = 'liberado' AND lp.excluido_em IS NULL
     AND (lp.disponivel_ate IS NULL OR lp.disponivel_ate > ?)`;

const atoDoPortal = (r: Linha) =>
  atoDoExame(texto(r['tipo']), r['sigla_padrao'] === null ? null : texto(r['sigla_padrao']));

function laudoDoPortal(r: Linha, comPaciente: boolean): LaudoPortal {
  return {
    liberacao: n(r['id']),
    exame: n(r['item']),
    nome: texto(r['nome']),
    setor: rotuloDoSetor(setorDoTipo(texto(r['tipo'])) ?? 'laboratorio'),
    data: dataIso(r['solicitado_em']) ?? '',
    liberadoEm: instante(r['liberado_em'] ?? r['publicado_em']),
    visualizado: r['primeira_visualizacao_em'] !== null,
    paciente: comPaciente ? texto(r['paciente_nome']) : null,
  };
}

async function laudosDoPortal(
  l: Leitor,
  filtro: string,
  p: readonly unknown[],
  atos: readonly number[],
  comPaciente: boolean,
): Promise<{ laudos: LaudoPortal[]; cortada: boolean }> {
  const ls = (
    await l.consultar(
      `${SQL_LAUDO_PORTAL}${filtro} ORDER BY lp.liberado_em DESC, lp.id DESC LIMIT ${TETO_PORTAL * 5}`,
      p,
      {
        teto: TETO_PORTAL * 5,
      },
    )
  ).filter((r) => atos.includes(atoDoPortal(r)));
  return {
    laudos: ls.slice(0, TETO_PORTAL).map((r) => laudoDoPortal(r, comPaciente)),
    cortada: ls.length > TETO_PORTAL,
  };
}

export class PortaSadtPropria implements PortaSadt {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSadt,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(c: ContextoSadt, fn: (l: Leitor, est: number) => Promise<T>): Promise<T> {
    const est = c.estabelecimento;
    if (est === null)
      return Promise.reject(recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.'));
    return this.nucleo.lerSomente(contextoDe(c), (l) => fn(l, est));
  }

  /** O dia civil do estabelecimento (AAAA-MM-DD) como o intervalo de instantes [início, fim) que o banco guarda. */
  private async diaCivil(l: Leitor, est: number, data: string): Promise<[Date, Date]> {
    const r = await l.uma<{ fuso_horario: string | null }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
      [est],
    );
    const fuso = r?.fuso_horario || FUSO_PADRAO;
    const seguinte = new Date(Date.parse(`${data}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    return [instanteCivil(data, '00:00', fuso), instanteCivil(seguinte, '00:00', fuso)];
  }

  private async hoje(l: Leitor, est: number): Promise<{ hoje: string; agora: string }> {
    const r = await l.uma<{ fuso_horario: string | null }>(
      'SELECT fuso_horario FROM estabelecimento WHERE id = ?',
      [est],
    );
    const x = relogioNoFuso(r?.fuso_horario || FUSO_PADRAO);
    return { hoje: x.hoje, agora: `${x.hoje}T${x.hora}:00` };
  }

  // ── Gravação ──────────────────────────────────────────────────────────────────────────────────────────────

  async podeGravar(_c: ContextoSadt, op: string): Promise<LiberacaoGravacao> {
    if (OPERACOES_SADT_DIRETAS.has(op)) return { pode: true, codigo: null, motivo: null };
    const motivo = OPERACOES_SADT_PENDENTES[op];
    if (motivo)
      return {
        pode: false,
        codigo: 'operacao-nao-liberada',
        motivo: `Operação desligada no banco: ${motivo}.`,
      };
    return { pode: false, codigo: 'operacao-desconhecida', motivo: 'Operação desconhecida no SADT.' };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async executar(_c: ContextoSadt, op: string, _entrada: unknown, _ctx: ContextoOperacao): Promise<never> {
    const motivo = OPERACOES_SADT_PENDENTES[op];
    throw motivo ? pendente(motivo) : recusa('operacao-desconhecida', 'Operação desconhecida no SADT.');
  }

  async gravarSgh<T>(
    c: ContextoSadt,
    trilha: TrilhaDaGravacao | ((r: T) => TrilhaDaGravacao),
    fn: (g: GravadorSghSadt) => Promise<T>,
  ): Promise<T> {
    const est = c.estabelecimento;
    if (est === null) throw recusa('sem-estabelecimento', 'Escolha o estabelecimento da sessão.');
    let saida: { valor: T } | null = null;
    const linha = () => (typeof trilha === 'function' ? (saida ? trilha(saida.valor) : null) : trilha);
    const op = definirOperacao({
      nome: nomeDaGravacao('sadt', trilha),
      tabelas: TABELAS_GRAVACAO,
      entrada: z.object({ chave: z.string() }),
      async gravar(tx) {
        saida = { valor: await fn(gravadorSobre(tx, est)) };
        return resultadoDe(saida.valor);
      },
      alvo: () => {
        const l = linha();
        return { tabela: l?.entidade ?? 'exame_item', id: l?.entidadeId ?? null };
      },
      trilha: () => ({ dados: linha()?.dadosDepois ?? null, motivo: linha()?.motivo ?? null }),
    });
    const chave = c.chaveIdempotencia ? `sadt:${c.chaveIdempotencia}` : `sadt:${randomUUID()}`;
    const r = await this.executor.executar(
      op,
      c.cliente,
      { chave },
      { ...contextoDe(c), chaveIdempotencia: chave },
    );
    // A mesma chave com a mesma entrada: o resultado da primeira execução, sem gravar de novo.
    if (!saida) return valorDe<T>(r.resultado);
    return (saida as { valor: T }).valor;
  }

  // ── Leituras ──────────────────────────────────────────────────────────────────────────────────────────────

  relogio(c: ContextoSadt) {
    return this.ler(c, (l, est) => this.hoje(l, est));
  }

  examesDoSetor(c: ContextoSadt, f: Parameters<PortaSadt['examesDoSetor']>[1]) {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      // O período pedido é em dias civis do estabelecimento; os instantes ficam gravados em UTC (ver diaCivil).
      const [inicio] = await this.diaCivil(l, est, f.inicio);
      const [, fim] = await this.diaCivil(l, est, f.fim);
      const p: unknown[] = [est, inicio, fim];
      let sql = `${SQL_EXAME} AND r.solicitado_em >= ? AND r.solicitado_em < ?`;
      if (f.setor) {
        const tipos = TIPOS_DO_SETOR[f.setor];
        sql += ` AND sd.tipo IN (${lista(tipos.length)})`;
        p.push(...tipos);
      }
      const situacoes = SITUACOES_DO_FILTRO[f.situacao ?? 'todos'] ?? null;
      if (situacoes) {
        sql += ` AND ei.situacao IN (${lista(situacoes.length)})`;
        p.push(...situacoes);
      } else sql += ` AND ei.situacao NOT IN ('cancelado', 'recusado')`;
      if (f.situacao === 'aEmitir') sql += ' AND ei.emitido_em IS NULL';
      if (f.urgentes) sql += " AND (ei.urgente = TRUE OR r.prioridade <> 'rotina')";
      if (f.unidade) {
        sql += ' AND r.unidade_assistencial_id = ?';
        p.push(f.unidade);
      }
      if (f.termo) {
        sql += ' AND (pf.nome LIKE ? OR e.nome LIKE ? OR e.codigo = ?)';
        p.push(`%${f.termo}%`, `%${f.termo}%`, f.termo);
      }
      if (f.ato) {
        const siglas = siglasDoAto(f.ato);
        if (siglas) {
          sql += ` AND mi.sigla_padrao IN (${lista(siglas.length)})`;
          p.push(...siglas);
        }
      }
      const ls = await l.consultar(
        `${sql} ORDER BY r.solicitado_em, ei.id LIMIT ${TETO_EXAMES_SADT + 1}`,
        p,
        {
          teto: TETO_EXAMES_SADT + 1,
        },
      );
      const todos = ls.map((r) => exameDe(r, hoje)).filter((x) => !f.ato || x.ato === f.ato);
      const itens = todos.slice(0, TETO_EXAMES_SADT);
      const contagens: Record<string, number> = {};
      for (const x of itens) contagens[x.estado] = (contagens[x.estado] ?? 0) + 1;
      return { itens, cortada: todos.length > TETO_EXAMES_SADT, contagens };
    });
  }

  async exame(c: ContextoSadt, id: number) {
    const [x] = await this.examesPorId(c, [id]);
    return x ?? null;
  }

  examesPorId(c: ContextoSadt, ids: readonly number[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      return (
        await l.consultar(`${SQL_EXAME} AND ei.id IN (${lista(ids.length)}) ORDER BY ei.id`, [est, ...ids])
      ).map((r) => exameDe(r, hoje));
    });
  }

  coleta(
    c: ContextoSadt,
    f: { inicio: string; fim: string; unidade?: number; deHora?: string; ateHora?: string },
  ) {
    return this.examesDoSetor(c, {
      setor: 'laboratorio',
      inicio: f.inicio,
      fim: f.fim,
      situacao: 'aReceber',
      ...(f.unidade ? { unidade: f.unidade } : {}),
    }).then((r) => {
      const grupos = new Map<string, ColetaGrupo>();
      const unidades = new Map<number, number>();
      for (const x of r.itens) {
        const hora = (x.previsaoColeta ?? x.pedidoEm ?? '').slice(11, 16);
        if ((f.deHora && hora < f.deHora) || (f.ateHora && hora > f.ateHora)) continue;
        if (x.atendimento.unidade !== null)
          unidades.set(x.atendimento.unidade, (unidades.get(x.atendimento.unidade) ?? 0) + 1);
        const k = `${x.paciente.id}:${x.recipiente?.codigo ?? 0}:${x.material ?? ''}`;
        const g = grupos.get(k) ?? {
          paciente: x.paciente,
          atendimento: {
            cabecalho: x.atendimento.cabecalho,
            tipo: x.atendimento.tipo,
            leito: x.atendimento.leito,
            unidade: x.atendimento.unidade,
          },
          recipiente: x.recipiente,
          material: x.material,
          previsao: x.previsaoColeta,
          urgente: false,
          exames: [],
          exigePulseira: x.atendimento.tipo === 'I',
        };
        g.urgente = g.urgente || x.urgente;
        const coletado =
          x.amostra !== null && x.amostra.estado !== 'rejeitada' && x.amostra.estado !== 'recoleta';
        g.exames.push({ id: x.id, codigo: x.exame.codigo, nome: x.exame.nome, coletado });
        grupos.set(k, g);
      }
      return {
        grupos: [...grupos.values()],
        cortada: r.cortada,
        unidades: [...unidades].map(([codigo, exames]) => ({ codigo, exames })),
      };
    });
  }

  mapa(c: ContextoSadt, f: { setor: SetorSadt; inicio: string; fim: string }) {
    return this.examesDoSetor(c, { setor: f.setor, inicio: f.inicio, fim: f.fim, situacao: 'aDigitar' }).then(
      async (r) => {
        // A bancada de cada exame pelo modelo de mapa do setor e os retidos nos lotes do estabelecimento (F3.5, linha 8).
        const lidos = await this.ler(c, (l, est) => lerBancadasDoMapa(l, est, r.itens));
        return {
          bancadas: distribuirPorBancada(r.itens, lidos.bancadas, lidos.retencoes),
          cortada: r.cortada,
        };
      },
    );
  }

  // ── Bancada: digitação, conferência e fila de liberação ──────────────────────────────────────────────────

  digitacao(c: ContextoSadt, id: number): Promise<ResultadoParaDigitacaoLido | null> {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const [r] = await l.consultar(`${SQL_EXAME} AND ei.id = ?`, [est, id], { teto: 1 });
      if (!r) return null;
      const exame = exameDe(r, hoje);
      // A faixa, o crítico e a idade valem na data do exame (coleta; sem ela, a solicitação), nunca na de hoje.
      const dia = dataDaReferencia({
        coletadaEm: dataIso(r['coletada_em']),
        solicitadoEm: dataIso(r['solicitado_em']),
        hoje,
      });
      const pac = await l.uma(
        `SELECT pf.sexo_id, DATEDIFF(?, pf.data_nascimento) AS dias
           FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE p.id = ?`,
        [dia, exame.paciente.id],
      );
      const re = await l.uma(
        `SELECT id, situacao, texto_resultado, conclusao FROM resultado_exame WHERE exame_item_id = ? AND excluido_em IS NULL`,
        [id],
      );
      const els = await l.consultar(
        `SELECT ea.id AS ea, an.id, an.nome, ea.titulo, COALESCE(ea.casas_decimais, an.casas_decimais) AS casas, ur.simbolo,
                an.tipo_resultado, an.limite_minimo_aceito, an.limite_maximo_aceito, ea.grupo_resposta_id
           FROM exame_analito ea JOIN analito an ON an.id = ea.analito_id
           LEFT JOIN unidade_resultado ur ON ur.id = COALESCE(ea.unidade_resultado_id, an.unidade_resultado_id)
          WHERE ea.exame_id = ? AND ea.ativo = TRUE AND ea.excluido_em IS NULL AND an.excluido_em IS NULL
          ORDER BY ea.ordem, ea.id`,
        [exame.exame.id],
        { teto: 500 },
      );
      const eas = els.map((x) => n(x['ea']));
      const analitos = els.map((x) => n(x['id']));
      // A faixa de referência vigente do analito no exame, da mais específica para a geral: a do sexo do paciente antes
      // da de ambos; a com idade antes da sem idade, e a faixa etária mais estreita antes da larga; só então a mais recente.
      const faixas = eas.length
        ? primeiraPor(
            await l.consultar(
              `SELECT exame_analito_id, referencia_minima, referencia_maxima, referencia_texto, vigencia_inicio
                 FROM faixa_referencia
                WHERE exame_analito_id IN (${lista(eas.length)}) AND ativo = TRUE AND condicao = 'nenhuma'
                  AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
                  AND (sexo_id IS NULL OR sexo_id = ?)
                  AND (idade_minima_dias IS NULL OR idade_minima_dias <= ?) AND (idade_maxima_dias IS NULL OR idade_maxima_dias >= ?)
                ORDER BY exame_analito_id, sexo_id IS NULL, (idade_minima_dias IS NULL AND idade_maxima_dias IS NULL),
                         COALESCE(idade_maxima_dias, 4294967295) - COALESCE(idade_minima_dias, 0), vigencia_inicio DESC, id DESC`,
              [...eas, dia, dia, pac?.['sexo_id'] ?? null, pac?.['dias'] ?? null, pac?.['dias'] ?? null],
              { teto: 5000 },
            ),
            'exame_analito_id',
          )
        : new Map<number, Linha>();
      // O valor crítico vigente do analito: o da unidade antes do da rede, o do exame antes do geral.
      const criticos = analitos.length
        ? primeiraPor(
            await l.consultar(
              `SELECT analito_id, limite_inferior, limite_superior, prazo_comunicacao_minutos FROM regra_valor_critico
                WHERE analito_id IN (${lista(analitos.length)}) AND ativo = TRUE AND (estabelecimento_id = ? OR estabelecimento_id IS NULL)
                  AND (exame_id IS NULL OR exame_id = ?) AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
                ORDER BY analito_id, estabelecimento_id IS NULL, exame_id IS NULL, vigencia_inicio DESC, id DESC`,
              [...analitos, est, exame.exame.id, dia, dia],
              { teto: 5000 },
            ),
            'analito_id',
          )
        : new Map<number, Linha>();
      const grupos = [
        ...new Set(els.filter((x) => x['grupo_resposta_id'] !== null).map((x) => n(x['grupo_resposta_id']))),
      ];
      const respostas = new Map<number, { codigo: number; texto: string }[]>();
      if (grupos.length)
        for (const x of await l.consultar(
          `SELECT id, grupo_resposta_id, descricao FROM resposta_padrao
            WHERE grupo_resposta_id IN (${lista(grupos.length)}) AND ativo = TRUE AND excluido_em IS NULL
            ORDER BY grupo_resposta_id, sequencia`,
          grupos,
          { teto: 5000 },
        )) {
          const g = n(x['grupo_resposta_id']);
          respostas.set(g, [
            ...(respostas.get(g) ?? []),
            { codigo: n(x['id']), texto: texto(x['descricao']) },
          ]);
        }
      const resultado = re ? n(re['id']) : null;
      const valores =
        resultado === null
          ? new Map<number, Linha>()
          : primeiraPor(
              await l.consultar(
                `SELECT ra.analito_id, ra.valor_numerico, ra.valor_absoluto, COALESCE(ra.valor_texto, rp.descricao) AS alfa,
                        ra.referencia_minimo, ra.referencia_maximo, ra.referencia_texto
                   FROM resultado_analito ra LEFT JOIN resposta_padrao rp ON rp.id = ra.resposta_padrao_id
                  WHERE ra.resultado_exame_id = ? AND ra.excluido_em IS NULL ORDER BY ra.sequencia`,
                [resultado],
                { teto: 500 },
              ),
              'analito_id',
            );
      const elementos: ElementoDigitacao[] = els.map((x) => {
        const f = faixas.get(n(x['ea']));
        const v = valores.get(n(x['id']));
        const cr = criticos.get(n(x['id']));
        // A referência guardada no resultado (a que valeu na digitação) vem antes da do cadastro.
        const guardada =
          v &&
          (v['referencia_minimo'] !== null ||
            v['referencia_maximo'] !== null ||
            v['referencia_texto'] !== null);
        const tipo = texto(x['tipo_resultado']);
        return {
          codigo: n(x['id']),
          nome: texto(x['nome']),
          titulo: verdadeiro(x['titulo']) || tipo === 'titulo',
          unidade: x['simbolo'] === null ? null : texto(x['simbolo']),
          casas: nn(x['casas']),
          numerico: tipo === 'numerico' || tipo === 'calculado',
          minimoAberto: nn(x['limite_minimo_aceito']),
          maximoAberto: nn(x['limite_maximo_aceito']),
          referencia: guardada
            ? {
                texto: v['referencia_texto'] === null ? null : texto(v['referencia_texto']),
                minimo: nn(v['referencia_minimo']),
                maximo: nn(v['referencia_maximo']),
                versao: null,
                fonte: 'historicoExame' as const,
              }
            : f
              ? {
                  texto: f['referencia_texto'] === null ? null : texto(f['referencia_texto']),
                  minimo: nn(f['referencia_minima']),
                  maximo: nn(f['referencia_maxima']),
                  versao: dataIso(f['vigencia_inicio']) ?? 'atual',
                  fonte: 'cadastro' as const,
                }
              : { texto: null, minimo: null, maximo: null, versao: null, fonte: 'nenhuma' as const },
          respostasPadrao:
            x['grupo_resposta_id'] === null ? [] : (respostas.get(n(x['grupo_resposta_id'])) ?? []),
          critico: cr
            ? {
                abaixoDe: nn(cr['limite_inferior']),
                acimaDe: nn(cr['limite_superior']),
                prazoMinutos: n(cr['prazo_comunicacao_minutos']),
              }
            : null,
          valor: v
            ? {
                numerico: nn(v['valor_numerico']),
                alfa: v['alfa'] === null ? null : texto(v['alfa']),
                absoluta: nn(v['valor_absoluto']),
              }
            : null,
        };
      });
      const variaveis =
        resultado === null
          ? []
          : (
              await l.consultar(
                `SELECT vf.id, vf.identificador, vf.descricao, rv.valor_numerico
                   FROM resultado_variavel_formula rv JOIN variavel_formula vf ON vf.id = rv.variavel_formula_id
                  WHERE rv.resultado_exame_id = ? AND rv.excluido_em IS NULL ORDER BY rv.sequencia`,
                [resultado],
                { teto: 200 },
              )
            ).map((x) => ({
              codigo: n(x['id']),
              identificacao: texto(x['identificador']),
              descricao: texto(x['descricao']),
              valor: nn(x['valor_numerico']),
            }));
      const observacoes =
        resultado === null
          ? []
          : (
              await l.consultar(
                'SELECT texto FROM resultado_observacao WHERE resultado_exame_id = ? AND excluido_em IS NULL ORDER BY sequencia',
                [resultado],
                { teto: 200 },
              )
            ).map((x) => texto(x['texto']));
      const modelos = (
        await l.consultar(
          `SELECT id, nome, COALESCE(texto_html, nota_fixa, '') AS texto FROM modelo_resultado
            WHERE exame_id = ? AND ativo = TRUE AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
            ORDER BY padrao DESC, nome, id`,
          [exame.exame.id, hoje, hoje],
          { teto: 200 },
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['nome']), texto: texto(x['texto']) }));
      const ld = await l.uma(
        `SELECT ld.texto, COALESCE(pr.nome_exibicao, pf.nome, '') AS emissor FROM laudo_diagnostico ld
           LEFT JOIN profissional pr ON pr.id = ld.laudista_profissional_id LEFT JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
          WHERE ld.exame_item_id = ? AND ld.excluido_em IS NULL AND ld.situacao <> 'cancelado'`,
        [id],
      );
      const textoLaudo = ld?.['texto'] ?? re?.['texto_resultado'] ?? null;
      const grandezas = (
        await l.consultar(
          `SELECT id, descricao, COALESCE(sigla, codigo) AS sigla FROM grandeza_laudo
            WHERE exame_id = ? AND ativo = TRUE ORDER BY ordem, id`,
          [exame.exame.id],
          { teto: 500 },
        )
      ).map((x) => ({ codigo: n(x['id']), nome: texto(x['descricao']), sigla: texto(x['sigla']) }));
      // Fórmula vigente na data do exame e textos padrão do exame (05-SADT linha 3): o calculado sai com a conta.
      const formulas = await lerFormulasDoExame(l, exame.exame.id ?? 0, dia);
      const textosPadrao = await lerTextosPadraoDoExame(l, exame.exame.id ?? 0);
      return {
        exame,
        ...comCalculo(elementos, variaveis, formulas, nn(pac?.['dias'])),
        textosPadrao,
        observacoes,
        modelos,
        laudo:
          textoLaudo === null
            ? null
            : { texto: texto(textoLaudo), html: texto(textoLaudo), emissor: texto(ld?.['emissor']) },
        alertaDataInvalida: false,
        bloqueado:
          ['liberado', 'emitido', 'visualizado'].includes(exame.estado) ||
          ['liberado', 'retificado'].includes(texto(re?.['situacao'])),
        grandezas,
      };
    });
  }

  conferencia(c: ContextoSadt, id: number): Promise<ItemLiberacao | null> {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const [r] = await l.consultar(`${SQL_EXAME} AND ei.id = ?`, [est, id], { teto: 1 });
      if (!r) return null;
      const [item] = await itensDeLiberacao(l, [exameDe(r, hoje)]);
      return item ?? null;
    });
  }

  async filaLiberacao(c: ContextoSadt, f: { setor?: SetorSadt | undefined; inicio: string; fim: string }) {
    const r = await this.examesDoSetor(c, {
      setor: f.setor,
      inicio: f.inicio,
      fim: f.fim,
      situacao: 'aLiberar',
    });
    const itens = await this.ler(c, (l) => itensDeLiberacao(l, r.itens));
    return { itens, cortada: r.cortada };
  }

  liberacaoVigente(c: ContextoSadt, id: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT re.id, re.liberado_em,
                EXISTS (SELECT 1 FROM visualizacao_resultado_exame v WHERE v.resultado_exame_id = re.id) AS visto
           FROM resultado_exame re
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE re.exame_item_id = ? AND r.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.excluido_em IS NULL
          ORDER BY re.numero_versao DESC, re.id DESC LIMIT 1`,
        [id, est],
      );
      return r
        ? {
            id: n(r['id']),
            em: r['liberado_em'] === null ? null : instante(r['liberado_em']),
            visualizada: verdadeiro(r['visto']),
          }
        : null;
    });
  }

  liberadosComCritico(c: ContextoSadt, o: { desde: Date; hoje: string }) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT re.id, re.exame_item_id, re.liberado_em, r.paciente_id, r.atendimento_id, r.numero, ei.sequencia,
                  COALESCE(u.login, '') AS usuario
             FROM resultado_exame re
             JOIN exame_item ei ON ei.id = re.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
             LEFT JOIN usuario u ON u.id = ei.liberado_por_usuario_id
            WHERE r.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.critico = TRUE
              AND re.excluido_em IS NULL AND re.liberado_em >= ?
              AND NOT EXISTS (SELECT 1 FROM aviso_valor_critico a WHERE a.resultado_exame_id = re.id)
            ORDER BY re.liberado_em, re.id`,
          [est, o.desde],
          { teto: 500 },
        )
      ).map((r) => ({
        exame: n(r['exame_item_id']),
        chave: `${texto(r['numero'])}:${n(r['sequencia'])}`,
        liberacao: n(r['id']),
        liberadoEm: r['liberado_em'] instanceof Date ? r['liberado_em'] : new Date(texto(r['liberado_em'])),
        paciente: n(r['paciente_id']),
        atendimento: n(r['atendimento_id']),
        usuario: texto(r['usuario']),
      })),
    );
  }

  avisos(c: ContextoSadt, o: { inicio: string; fim: string; pendentes?: boolean }) {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const ls = await l.consultar(
        `SELECT a.id, a.gerado_em, a.prazo_em, a.situacao, a.nivel_escalonamento, a.comunicado_descricao, a.comunicado_em,
                a.leitura_confirmada_em, ei.id AS exame_item_id, COALESCE(re.liberado_em, ld.assinado_em) AS liberado_em,
                r.numero, ei.sequencia, r.atendimento_id,
                at.numero AS atendimento_numero, p.id AS paciente_id, p.numero_prontuario, pf.nome, pf.data_nascimento,
                sx.sigla AS sexo, COALESCE(an.nome, IF(ld.id IS NULL, NULL, 'Achado crítico do laudo')) AS analito,
                ra.valor_numerico, COALESCE(ra.valor_texto, ld.achado_critico_descricao) AS valor_texto, ur.simbolo,
                (SELECT cn.descricao FROM aviso_valor_critico_tentativa t JOIN canal_notificacao cn ON cn.id = t.canal_notificacao_id
                  WHERE t.aviso_valor_critico_id = a.id ORDER BY t.sequencia DESC LIMIT 1) AS canal,
                COALESCE(uc.login, '') AS comunicado_por, COALESCE(pcf.nome, a.comunicado_descricao, '') AS destinatario
           FROM aviso_valor_critico a
           LEFT JOIN resultado_exame re ON re.id = a.resultado_exame_id
           LEFT JOIN laudo_diagnostico ld ON ld.id = a.laudo_diagnostico_id
           JOIN exame_item ei ON ei.id = COALESCE(re.exame_item_id, ld.exame_item_id)
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN atendimento at ON at.id = r.atendimento_id
           JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
           LEFT JOIN sexo sx ON sx.id = pf.sexo_id
           LEFT JOIN resultado_analito ra ON ra.id = a.resultado_analito_id
           LEFT JOIN analito an ON an.id = ra.analito_id
           LEFT JOIN unidade_resultado ur ON ur.id = ra.unidade_resultado_id
           LEFT JOIN usuario uc ON uc.id = a.comunicado_por_usuario_id
           LEFT JOIN profissional pc ON pc.id = a.comunicado_profissional_id
           LEFT JOIN pessoa_fisica pcf ON pcf.id = pc.pessoa_fisica_id
          WHERE a.estabelecimento_id = ? AND a.excluido_em IS NULL
            AND a.gerado_em >= ? AND a.gerado_em < DATE_ADD(?, INTERVAL 1 DAY)
            ${o.pendentes ? "AND a.situacao IN ('pendente', 'em_contato', 'escalonado')" : ''}
          ORDER BY a.gerado_em DESC, a.id DESC`,
        [est, o.inicio, o.fim],
        { teto: 500 },
      );
      return ls.map((r): AvisoCritico => {
        const nivel = Math.min(2, n(r['nivel_escalonamento'])) as 0 | 1 | 2;
        const nasc = dataIso(r['data_nascimento']);
        const sexo = texto(r['sexo']).toUpperCase();
        const gerado = instante(r['gerado_em']);
        const liberado = instante(r['liberado_em']) || gerado;
        const sit = texto(r['situacao']);
        return {
          id: n(r['id']),
          exame: n(r['exame_item_id']),
          chave: `${texto(r['numero'])}:${n(r['sequencia'])}`,
          paciente: {
            id: n(r['paciente_id']),
            prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
            nome: texto(r['nome']),
            sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
            idadeAnos: idadeAnos(nasc, hoje),
            nascimento: nasc,
          },
          atendimento: texto(r['atendimento_numero']),
          elemento: texto(r['analito']),
          valor:
            r['valor_numerico'] !== null && r['valor_numerico'] !== undefined
              ? `${texto(r['valor_numerico'])}${r['simbolo'] ? ` ${texto(r['simbolo'])}` : ''}`
              : texto(r['valor_texto']),
          origem: 'novo',
          liberadoEm: liberado,
          emitidoEm: gerado,
          segundosAteAviso: Math.max(0, Math.round((Date.parse(gerado) - Date.parse(liberado)) / 1000)),
          prazoEm: instante(r['prazo_em']),
          nivel,
          nivelRotulo: NIVEIS_ESCALONAMENTO[nivel]?.rotulo ?? String(nivel),
          comunicado:
            r['comunicado_em'] === null
              ? null
              : {
                  canal: texto(r['canal']),
                  destinatario: texto(r['destinatario']),
                  por: texto(r['comunicado_por']),
                  em: instante(r['comunicado_em']),
                },
          ciencia:
            r['leitura_confirmada_em'] === null
              ? null
              : { usuario: texto(r['comunicado_por']), em: instante(r['leitura_confirmada_em']) },
          situacao:
            sit === 'comunicado' || sit === 'leitura_confirmada'
              ? 'comCiencia'
              : nivel > 0 || sit === 'escalonado'
                ? 'escalonado'
                : 'aguardandoCiencia',
        };
      });
    });
  }

  valoresCriticos(c: ContextoSadt) {
    return this.ler(c, async (l, est) =>
      (
        await l.consultar(
          `SELECT v.id, v.limite_inferior, v.limite_superior, v.prazo_comunicacao_minutos, v.ativo, v.vigencia_inicio,
                  COALESCE(v.alterado_em, v.criado_em) AS atualizado, e.codigo, e.nome AS exame_nome, an.id AS analito,
                  an.nome AS analito_nome, sd.tipo, mi.sigla_padrao
             FROM regra_valor_critico v
             JOIN exame e ON e.id = v.exame_id
             LEFT JOIN analito an ON an.id = v.analito_id
             LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
             LEFT JOIN setor_diagnostico sd ON sd.tipo = CASE e.tipo_servico WHEN 'imagem' THEN 'imagem' ELSE 'laboratorio' END
                   AND sd.estabelecimento_id = ? AND sd.excluido_em IS NULL AND sd.id = (
                     SELECT MIN(s2.id) FROM setor_diagnostico s2 WHERE s2.estabelecimento_id = ? AND s2.tipo = sd.tipo)
            WHERE (v.estabelecimento_id = ? OR v.estabelecimento_id IS NULL) AND v.vigencia_fim IS NULL
              -- A regra da unidade sobrepõe a da rede (regra da rede: vale para todas as unidades sem regra própria).
              AND NOT (v.estabelecimento_id IS NULL AND EXISTS (
                    SELECT 1 FROM regra_valor_critico u WHERE u.estabelecimento_id = ? AND u.exame_id <=> v.exame_id
                       AND u.analito_id <=> v.analito_id AND u.vigencia_fim IS NULL))
            ORDER BY e.codigo, an.nome, v.id`,
          [est, est, est, est],
        )
      ).map((r): ValorCriticoLido => ({
        id: n(r['id']),
        ato: atoDoExame(
          texto(r['tipo']) || 'laboratorio',
          r['sigla_padrao'] === null ? null : texto(r['sigla_padrao']),
        ),
        exame: texto(r['codigo']),
        exameNome: texto(r['exame_nome']),
        elemento: n(r['analito']),
        elementoNome: texto(r['analito_nome']),
        abaixoDe: nn(r['limite_inferior']),
        acimaDe: nn(r['limite_superior']),
        prazoMinutos: n(r['prazo_comunicacao_minutos']),
        aprovacao: `Vigente desde ${dataIso(r['vigencia_inicio']) ?? ''}`,
        ativo: verdadeiro(r['ativo']),
        atualizadoEm: instante(r['atualizado']),
      })),
    );
  }

  elementos(c: ContextoSadt, exame: string) {
    // Catálogo de exames e analitos da rede inteira (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT an.id, an.nome, ur.simbolo
             FROM exame e
             JOIN exame_analito ea ON ea.exame_id = e.id AND ea.ativo = TRUE AND ea.excluido_em IS NULL
             JOIN analito an ON an.id = ea.analito_id AND an.excluido_em IS NULL
             LEFT JOIN unidade_resultado ur ON ur.id = COALESCE(ea.unidade_resultado_id, an.unidade_resultado_id)
            WHERE e.codigo = ? AND e.excluido_em IS NULL
            ORDER BY ea.ordem, an.id`,
          [exame],
        )
      ).map((r) => ({
        codigo: n(r['id']),
        nome: texto(r['nome']),
        unidade: r['simbolo'] === null ? null : texto(r['simbolo']),
      })),
    );
  }

  private async amostrasDe(l: Leitor, est: number, filtro: string, p: unknown[]): Promise<AmostraDetalhe[]> {
    const { hoje } = await this.hoje(l, est);
    const ls = await l.consultar(`${SQL_AMOSTRA} ${filtro} ORDER BY am.id DESC`, [est, ...p], { teto: 501 });
    if (ls.length === 0) return [];
    const ids = ls.map((r) => n(r['id']));
    const exames = await l.consultar(
      `SELECT abe.amostra_biologica_id, ei.id, e.codigo, e.nome FROM amostra_biologica_exame abe
         JOIN exame_item ei ON ei.id = abe.exame_item_id JOIN exame e ON e.id = ei.exame_id
        WHERE abe.excluido_em IS NULL AND abe.amostra_biologica_id IN (${lista(ids.length)}) ORDER BY ei.id`,
      ids,
    );
    const eventos = await l.consultar(
      `SELECT ev.amostra_biologica_id, ev.evento, ev.ocorrido_em, ev.descricao, ev.dados, COALESCE(u.login, '') AS por
         FROM amostra_biologica_evento ev LEFT JOIN usuario u ON u.id = ev.usuario_id
        WHERE ev.amostra_biologica_id IN (${lista(ids.length)}) ORDER BY ev.ocorrido_em, ev.id`,
      ids,
    );
    return ls.map((r) => {
      const id = n(r['id']);
      const estado = estadoDaAmostra(texto(r['situacao']));
      const evs = eventos.filter((e) => n(e['amostra_biologica_id']) === id);
      const nasc = dataIso(r['data_nascimento']);
      const sexo = texto(r['sexo']).toUpperCase();
      return {
        id,
        codigo: texto(r['codigo_barras']),
        estado,
        rotulo: rotuloEstadoAmostra(estado),
        paciente: {
          id: n(r['paciente_id']),
          prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
          nome: texto(r['paciente_nome']),
          sexo: sexo === 'M' || sexo === 'F' ? sexo : null,
          idadeAnos: idadeAnos(nasc, hoje),
          nascimento: nasc,
        },
        recipiente: r['recipiente'] === null ? null : texto(r['recipiente']),
        exames: exames
          .filter((e) => n(e['amostra_biologica_id']) === id)
          .map((e) => ({ id: n(e['id']), codigo: texto(e['codigo']), nome: texto(e['nome']) })),
        pulseiraConferida: evs.some((e) => {
          const d =
            typeof e['dados'] === 'string' ? (JSON.parse(e['dados']) as Linha) : (e['dados'] as Linha | null);
          return verdadeiro(d?.['pulseiraConferida']);
        }),
        eventos: evs
          .filter((e) => texto(e['evento']) !== 'ocorrencia' && texto(e['evento']) !== 'etiqueta_impressa')
          .map((e) => {
            const est2 = estadoDoEvento(texto(e['evento']));
            return {
              estado: est2,
              rotulo: rotuloEstadoAmostra(est2),
              em: instante(e['ocorrido_em']),
              por: texto(e['por']),
              motivo: e['descricao'] === null ? null : texto(e['descricao']),
            };
          }),
      };
    });
  }

  amostras(c: ContextoSadt, o: { data: string; estado?: EstadoAmostra }) {
    return this.ler(c, async (l, est) => {
      // O dia pedido é o dia civil do estabelecimento; os instantes ficam gravados em UTC. Sem a conversão, a amostra
      // colhida à noite (depois das 21h no fuso de Brasília) caía no dia seguinte e sumia do rastreio do dia.
      const [inicio, fim] = await this.diaCivil(l, est, o.data);
      const p: unknown[] = [inicio, fim];
      let f =
        'AND COALESCE(am.coletada_em, am.criado_em) >= ? AND COALESCE(am.coletada_em, am.criado_em) < ?';
      if (o.estado) {
        f += ' AND am.situacao = ?';
        p.push(SITUACAO_DA_AMOSTRA[o.estado].situacao);
      }
      const itens = await this.amostrasDe(l, est, f, p);
      const rejeicoes = await l.consultar(
        `SELECT COALESCE(ev.descricao, 'Sem motivo') AS motivo, COUNT(*) AS quantidade
           FROM amostra_biologica_evento ev JOIN amostra_biologica am ON am.id = ev.amostra_biologica_id
          WHERE am.estabelecimento_id = ? AND ev.evento = 'rejeitada'
            AND ev.ocorrido_em >= ? AND ev.ocorrido_em < ?
          GROUP BY COALESCE(ev.descricao, 'Sem motivo') ORDER BY quantidade DESC`,
        [est, inicio, fim],
      );
      return {
        itens: itens.slice(0, 500),
        cortada: itens.length > 500,
        rejeicoes: rejeicoes.map((r) => ({ motivo: texto(r['motivo']), quantidade: n(r['quantidade']) })),
      };
    });
  }

  amostraPorCodigo(c: ContextoSadt, codigo: string) {
    return this.ler(
      c,
      async (l, est) => (await this.amostrasDe(l, est, 'AND am.codigo_barras = ?', [codigo]))[0] ?? null,
    );
  }

  amostraPorId(c: ContextoSadt, id: number) {
    return this.ler(c, async (l, est) => (await this.amostrasDe(l, est, 'AND am.id = ?', [id]))[0] ?? null);
  }

  atendimentoDosExames(c: ContextoSadt, ids: readonly number[]) {
    if (ids.length === 0) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT DISTINCT r.paciente_id, r.atendimento_id, p.numero_prontuario,
                EXISTS (SELECT 1 FROM internacao i WHERE i.atendimento_id = r.atendimento_id) AS internado
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN paciente p ON p.id = r.paciente_id
          WHERE r.estabelecimento_id = ? AND ei.excluido_em IS NULL AND ei.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      const r = ls[0];
      if (!r) return null;
      return {
        paciente: n(r['paciente_id']),
        atendimento: n(r['atendimento_id']),
        reg: n(r['atendimento_id']),
        atend: verdadeiro(r['internado']) ? ('I' as const) : ('E' as const),
        prontuario: Number(texto(r['numero_prontuario']).replace(/\D/g, '')) || 0,
        mesmos: ls.length === 1,
      };
    });
  }

  laudosDoExame(c: ContextoSadt, id: number) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT el.numero, el.codigo_autenticacao, el.emitida_em, COALESCE(u.login, '') AS por,
                (SELECT COUNT(*) FROM emissao_laudo v WHERE v.emissao_original_id = el.id AND v.excluido_em IS NULL) AS vias
           FROM emissao_laudo_exame ex JOIN emissao_laudo el ON el.id = ex.emissao_laudo_id
           LEFT JOIN usuario u ON u.id = el.emitido_por_usuario_id
          WHERE ex.exame_item_id = ? AND el.estabelecimento_id = ? AND el.excluido_em IS NULL AND ex.excluido_em IS NULL
            AND el.emissao_original_id IS NULL AND el.tipo_emissao <> 'reimpressao'
          ORDER BY el.emitida_em, el.id`,
        [id, est],
      );
      // Cada laudo com as suas vias seguintes (as reimpressões ligadas à emissão original dele).
      return ls.map((r) => ({
        numero: texto(r['numero']),
        codigo: texto(r['codigo_autenticacao']),
        emitidoEm: instante(r['emitida_em']),
        emitidoPor: texto(r['por']),
        segundasVias: n(r['vias']),
      }));
    });
  }

  impressaoDosExames(c: ContextoSadt, ids: readonly number[]) {
    if (ids.length === 0) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT el.id, el.numero, el.codigo_autenticacao, COUNT(DISTINCT ex.exame_item_id) AS exames,
                (SELECT COALESCE(MAX(v.numero_via), 1) FROM emissao_laudo v
                  WHERE v.emissao_original_id = el.id OR v.id = el.id) AS vias
           FROM emissao_laudo el JOIN emissao_laudo_exame ex ON ex.emissao_laudo_id = el.id AND ex.excluido_em IS NULL
          WHERE el.estabelecimento_id = ? AND el.excluido_em IS NULL AND el.tipo_emissao <> 'reimpressao'
            AND el.emissao_original_id IS NULL AND ex.exame_item_id IN (${lista(ids.length)})
          GROUP BY el.id, el.numero, el.codigo_autenticacao HAVING COUNT(DISTINCT ex.exame_item_id) = ?
          ORDER BY el.id DESC LIMIT 1`,
        [est, ...ids, new Set(ids).size],
      );
      return r
        ? {
            impressao: n(r['id']),
            numero: texto(r['numero']),
            codigo: texto(r['codigo_autenticacao']),
            vias: n(r['vias']),
          }
        : null;
    });
  }

  validarLaudo(c: ContextoSadt, codigo: string) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT el.id, el.numero, el.emitida_em, (SELECT COUNT(*) FROM emissao_laudo_exame ex WHERE ex.emissao_laudo_id = el.id
                                   AND ex.excluido_em IS NULL) AS exames,
                (SELECT MAX(u.emitida_em) FROM emissao_laudo u WHERE u.estabelecimento_id = el.estabelecimento_id
                    AND u.codigo_autenticacao = el.codigo_autenticacao AND u.excluido_em IS NULL) AS ultima_via
           FROM emissao_laudo el WHERE el.estabelecimento_id = ? AND el.codigo_autenticacao = ? AND el.excluido_em IS NULL
          ORDER BY el.numero_via, el.id LIMIT 1`,
        [est, codigo],
      );
      // O laudo retificado depois da última via emitida: o código continua achando a emissão, mas ela não é mais a
      // atual (a validação diz isso, sem dado clínico).
      const retificacoes = r
        ? (
            await l.consultar(
              `SELECT v.ocorrido_em FROM emissao_laudo_exame ex
                 JOIN laudo_diagnostico ld ON ld.exame_item_id = ex.exame_item_id AND ld.excluido_em IS NULL
                 JOIN laudo_diagnostico_versao v ON v.laudo_diagnostico_id = ld.id AND v.situacao = 'retificado'
                WHERE ex.emissao_laudo_id = ? AND ex.excluido_em IS NULL`,
              [n(r['id'])],
            )
          ).map((x) => new Date(x['ocorrido_em'] as string | Date))
        : [];
      // A validação pública devolve o número do laudo (impresso no PDF ao lado do código), nunca dado clínico.
      return r
        ? {
            valido: true,
            superado: emissaoSuperada(
              new Date((r['ultima_via'] ?? r['emitida_em']) as string | Date),
              retificacoes,
            ),
            numero: texto(r['numero']),
            emitidoEm: instante(r['emitida_em']),
            exames: n(r['exames']),
          }
        : { valido: false, numero: null, emitidoEm: null, exames: 0 };
    });
  }

  laudoParaEmitir(c: ContextoSadt, ids: readonly number[]): Promise<LaudoParaEmitir | null> {
    const unicos = [...new Set(ids)];
    if (unicos.length === 0) return Promise.resolve(null);
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const exames = (
        await l.consultar(`${SQL_EXAME} AND ei.id IN (${lista(unicos.length)}) ORDER BY ei.id`, [
          est,
          ...unicos,
        ])
      ).map((r) => exameDe(r, hoje));
      // Um laudo é de um paciente só, e todos os exames são deste estabelecimento.
      if (exames.length !== unicos.length || new Set(exames.map((x) => x.paciente.id)).size > 1) return null;
      const ls = await l.consultar(
        `SELECT ei.id, ei.liberado_em, COALESCE(u.login, '') AS por, re.id AS resultado, re.texto_resultado, re.conclusao,
                IF(ld.situacao IN ('assinado', 'emitido', 'retificado'), ld.texto, NULL) AS laudo, ld.situacao AS laudo_situacao,
                COALESCE(lp.nome_exibicao, lpf.nome, '') AS laudista, fp.nome AS convenio
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
           JOIN atendimento a ON a.id = r.atendimento_id
           LEFT JOIN fonte_pagadora fp ON fp.id = COALESCE(r.fonte_pagadora_id, a.fonte_pagadora_id)
           LEFT JOIN usuario u ON u.id = ei.liberado_por_usuario_id
           LEFT JOIN resultado_exame re ON re.exame_item_id = ei.id AND re.excluido_em IS NULL
           LEFT JOIN laudo_diagnostico ld ON ld.exame_item_id = ei.id AND ld.excluido_em IS NULL AND ld.situacao <> 'cancelado'
           LEFT JOIN profissional lp ON lp.id = ld.laudista_profissional_id
           LEFT JOIN pessoa_fisica lpf ON lpf.id = lp.pessoa_fisica_id
          WHERE r.estabelecimento_id = ? AND ei.id IN (${lista(unicos.length)})`,
        [est, ...unicos],
      );
      const por = new Map(ls.map((x) => [n(x['id']), x]));
      // Exame com laudo ainda não assinado (rascunho, aguardando revisão) não sai impresso: nem o rascunho como laudo
      // oficial, nem o texto do resultado no lugar dele.
      const semAssinatura = ls.filter(
        (x) => x['laudo_situacao'] !== null && !LAUDO_ASSINADO.includes(texto(x['laudo_situacao'])),
      );
      if (semAssinatura.length > 0)
        throw recusa(
          'laudo-nao-assinado',
          `O laudo ainda não foi assinado (exame ${semAssinatura.map((x) => n(x['id'])).join(', ')}): assine-o antes de emitir.`,
        );
      const valores = await valoresDosResultados(
        l,
        ls.filter((x) => x['resultado'] !== null).map((x) => n(x['resultado'])),
      );
      const x0 = exames[0]!;
      return {
        paciente: x0.paciente,
        atendimento: x0.atendimento.cabecalho,
        convenio: texto(por.get(x0.id)?.['convenio']),
        exames: exames.map((x) => {
          const d = por.get(x.id);
          return {
            id: x.id,
            nome: x.exame.nome,
            setor: rotuloDoSetor(x.setor),
            data: x.chave.data,
            liberadoEm: d?.['liberado_em'] ? instante(d['liberado_em']) : null,
            liberadoPor: texto(d?.['por']),
            valores: d && d['resultado'] !== null ? (valores.get(n(d['resultado'])) ?? []) : [],
            texto: linhasDoLaudo(d),
            emissor: d?.['laudo'] === null || d?.['laudo'] === undefined ? '' : texto(d['laudista']),
          };
        }),
      };
    });
  }

  requisicoes(c: ContextoSadt, o: { data: string; termo?: string }) {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const p: unknown[] = [est, o.data, o.data];
      let f = '';
      if (o.termo) {
        f = ' AND (pf.nome LIKE ? OR a.numero = ?)';
        p.push(`%${o.termo}%`, o.termo);
      }
      const ls = await l.consultar(
        `${SQL_ATENDIMENTO_LANCAMENTO} AND a.entrada_em >= ? AND a.entrada_em < DATE_ADD(?, INTERVAL 1 DAY)${f}
          ORDER BY a.entrada_em, a.id LIMIT ${TETO_REQUISICOES + 1}`,
        p,
        { teto: TETO_REQUISICOES + 1 },
      );
      const atendimentos = ls.slice(0, TETO_REQUISICOES);
      const contas = atendimentos.filter((r) => r['conta_id'] !== null).map((r) => n(r['conta_id']));
      const dados = new Map<number, Linha>();
      if (contas.length)
        for (const r of await l.consultar(
          `SELECT q.id, COALESCE(pr.nome_exibicao, pfp.nome, '') AS solicitante,
                  COALESCE(g.numero_guia_operadora, g.numero_guia_prestador, '') AS guia
             FROM requisicao_exame q
             LEFT JOIN profissional pr ON pr.id = q.solicitante_profissional_id
             LEFT JOIN pessoa_fisica pfp ON pfp.id = pr.pessoa_fisica_id
             LEFT JOIN guia_tiss g ON g.id = q.guia_tiss_id AND g.excluido_em IS NULL
            WHERE q.id IN (${lista(contas.length)})`,
          contas,
          { teto: contas.length },
        ))
          dados.set(n(r['id']), r);
      const itens: RequisicaoLida[] = atendimentos.map((r) => {
        const d = r['conta_id'] === null ? undefined : dados.get(n(r['conta_id']));
        return {
          atendimento: texto(r['numero']),
          reg: n(r['id']),
          paciente: pacienteDe(r, hoje),
          convenio: { codigo: n(r['fp_id']), nome: texto(r['fp_nome']) },
          data: dataIso(r['entrada_em']) ?? o.data,
          conta:
            r['conta_id'] === null
              ? null
              : {
                  id: n(r['conta_id']),
                  numero: numeroDeNegocio(r['conta_numero']),
                  solicitante: texto(d?.['solicitante']),
                  guia: texto(d?.['guia']),
                },
          exames: n(r['exames']),
        };
      });
      return { itens, cortada: ls.length > TETO_REQUISICOES };
    });
  }

  atendimento(c: ContextoSadt, atendimento: number): Promise<AtendimentoParaLancamento | null> {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      const [r] = await l.consultar(`${SQL_ATENDIMENTO_LANCAMENTO} AND a.id = ?`, [est, atendimento], {
        teto: 1,
      });
      return r ? atendimentoDe(r, hoje) : null;
    });
  }

  /** O número do atendimento (o da recepção) ou o id: os dois identificam o atendimento na busca. */
  atendimentosPorNumero(c: ContextoSadt, reg: number): Promise<AtendimentoParaLancamento[]> {
    return this.ler(c, async (l, est) => {
      const { hoje } = await this.hoje(l, est);
      return (
        await l.consultar(
          `${SQL_ATENDIMENTO_LANCAMENTO} AND (a.id = ? OR a.numero = ?) ORDER BY a.id`,
          [est, reg, String(reg)],
          {
            teto: 20,
          },
        )
      ).map((r) => atendimentoDe(r, hoje));
    });
  }

  orcamentos(
    c: ContextoSadt,
    o: { inicio: string; fim: string; hoje: string; termo?: string; validadeDias: number },
  ) {
    return this.ler(c, async (l, est) => {
      const p: unknown[] = [est, o.inicio, o.fim];
      let f = '';
      if (o.termo) {
        f = ' AND COALESCE(op.nome_interessado, pf.nome) LIKE ?';
        p.push(`%${o.termo}%`);
      }
      const ls = await l.consultar(
        `${SQL_ORCAMENTO} AND op.data_orcamento BETWEEN ? AND ?${f}
          ORDER BY op.data_orcamento DESC, op.id DESC LIMIT ${TETO_ORCAMENTOS + 1}`,
        p,
        { teto: TETO_ORCAMENTOS + 1 },
      );
      return {
        itens: await orcamentosLidos(l, ls.slice(0, TETO_ORCAMENTOS), o.hoje),
        cortada: ls.length > TETO_ORCAMENTOS,
      };
    });
  }

  orcamento(c: ContextoSadt, id: number, o: { hoje: string; validadeDias: number }) {
    return this.ler(c, async (l, est) => {
      const [r] = await l.consultar(`${SQL_ORCAMENTO} AND op.id = ?`, [est, id], { teto: 1 });
      if (!r) return null;
      const [x] = await orcamentosLidos(l, [r], o.hoje);
      return x ? { ...x, nomeRegistrado: texto(r['nome_interessado']) || texto(r['paciente_nome']) } : null;
    });
  }

  apoio(c: ContextoSadt, setor?: SetorSadt): Promise<ApoioSadtLido> {
    return this.ler(c, async (l, est) => {
      const tipos = setor ? TIPOS_DO_SETOR[setor] : TIPOS_SADT;
      const prestadores = (
        await l.consultar(
          `SELECT id, nome, tipo FROM setor_diagnostico
            WHERE estabelecimento_id = ? AND ativo = TRUE AND excluido_em IS NULL AND tipo IN (${lista(tipos.length)})
            ORDER BY nome, id`,
          [est, ...tipos],
          { teto: 500 },
        )
      ).map((r) => ({
        id: n(r['id']),
        ato: atoDoExame(texto(r['tipo']), null),
        codigo: n(r['id']),
        nome: texto(r['nome']),
      }));
      // O setor do exame: o executante padrão deste estabelecimento; sem ele, o tipo de serviço do catálogo.
      const exames = (
        await l.consultar(
          `SELECT x.* FROM (
             SELECT e.id, e.codigo, e.nome, mi.sigla_padrao, mb.descricao AS material, rc.descricao AS recipiente,
                    COALESCE((SELECT sd.tipo FROM exame_setor_executante es
                                JOIN setor_diagnostico sd ON sd.id = es.setor_diagnostico_id
                               WHERE es.exame_id = e.id AND es.ativo = TRUE AND es.excluido_em IS NULL
                                 AND sd.estabelecimento_id = ? AND sd.ativo = TRUE AND sd.excluido_em IS NULL
                               ORDER BY es.padrao DESC, es.id LIMIT 1),
                             CASE e.tipo_servico WHEN 'laboratorio' THEN 'laboratorio' WHEN 'imagem' THEN 'imagem'
                                  WHEN 'metodo_grafico' THEN 'metodos_graficos' END) AS tipo_setor
               FROM exame e
               LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
               LEFT JOIN exame_material em ON em.id = (SELECT m.id FROM exame_material m WHERE m.exame_id = e.id AND m.ativo = TRUE
                                                          AND m.excluido_em IS NULL ORDER BY m.padrao DESC, m.id LIMIT 1)
               LEFT JOIN material_biologico mb ON mb.id = em.material_biologico_id
               LEFT JOIN recipiente_coleta rc ON rc.id = em.recipiente_coleta_id
              WHERE e.ativo = TRUE AND e.excluido_em IS NULL) x
            WHERE x.tipo_setor IN (${lista(tipos.length)}) ORDER BY x.nome, x.id LIMIT ${TETO_CATALOGO}`,
          [est, ...tipos],
          { teto: TETO_CATALOGO },
        )
      ).map((r) => ({
        id: n(r['id']),
        ato: atoDoExame(texto(r['tipo_setor']), r['sigla_padrao'] === null ? null : texto(r['sigla_padrao'])),
        codigo: texto(r['codigo']),
        nome: texto(r['nome']),
        material: r['material'] === null ? null : texto(r['material']),
        recipiente: r['recipiente'] === null ? null : texto(r['recipiente']),
      }));
      const kits = (
        await l.consultar(
          'SELECT id, nome FROM kit_exame WHERE ativo = TRUE AND excluido_em IS NULL ORDER BY nome, id',
          [],
          {
            teto: TETO_CATALOGO,
          },
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) }));
      const recipientes = (
        await l.consultar(
          'SELECT id, descricao FROM recipiente_coleta WHERE ativo = TRUE ORDER BY descricao, id',
          [],
          {
            teto: TETO_CATALOGO,
          },
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['descricao']) }));
      const convenios = (
        await l.consultar(
          "SELECT id, nome FROM fonte_pagadora WHERE situacao = 'ativa' AND excluido_em IS NULL ORDER BY nome, id",
          [],
          { teto: TETO_CATALOGO },
        )
      ).map((r) => ({ codigo: n(r['id']), nome: texto(r['nome']) }));
      return { prestadores, exames, kits, recipientes, convenios };
    });
  }

  vinculos(c: ContextoSadt, login: string): Promise<VinculoDaSessao[]> {
    // Profissional e inscrição no conselho são do cliente inteiro (sem estabelecimento).
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT ic.id, ic.numero_inscricao, COALESCE(pr.nome_exibicao, pf.nome) AS nome, COALESCE(oc.codigo_cbo, '') AS cbo,
                  (ic.situacao = 'ativa' AND pr.situacao = 'ativo') AS ativo
             FROM usuario u
             JOIN profissional pr ON pr.pessoa_fisica_id = u.pessoa_fisica_id AND pr.excluido_em IS NULL
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
             JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
             LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
            WHERE u.login = ? AND u.excluido_em IS NULL
            ORDER BY ic.principal DESC, ic.id`,
          [login],
        )
      ).map((r) => ({
        vinculo: n(r['id']),
        conselho: Number(texto(r['numero_inscricao']).replace(/\D/g, '')) || 0,
        nome: texto(r['nome']),
        codigoCbo: texto(r['cbo']),
        ativo: verdadeiro(r['ativo']),
      })),
    );
  }

  /**
   * O solicitante da requisição do exame (regra_valor_critico.comunica_solicitante): o usuário ativo ligado ao
   * profissional pelo vínculo vigente na unidade ou, sem vínculo, pela mesma pessoa. Nunca o profissional do
   * atendimento, que na requisição de laboratório é o executante. Sem solicitante com usuário, null: o aviso segue no
   * painel do setor (o plantonista do setor entra com a leitura da escala, pedido do lote 02-09).
   */
  destinatarioDoCritico(c: ContextoSadt, exameItem: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT u.login FROM exame_item ei
           JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
           JOIN profissional pr ON pr.id = q.solicitante_profissional_id AND pr.excluido_em IS NULL
           JOIN usuario u ON u.situacao = 'ativo' AND u.excluido_em IS NULL
          WHERE ei.id = ? AND q.estabelecimento_id = ? AND q.excluido_em IS NULL AND ei.excluido_em IS NULL
            AND (EXISTS (SELECT 1 FROM usuario_vinculo_profissional v
                          WHERE v.usuario_id = u.id AND v.profissional_id = pr.id AND v.estabelecimento_id = q.estabelecimento_id
                            AND v.excluido_em IS NULL AND v.vigencia_inicio <= CURRENT_DATE
                            AND (v.vigencia_fim IS NULL OR v.vigencia_fim >= CURRENT_DATE))
                 OR u.pessoa_fisica_id = pr.pessoa_fisica_id)
          ORDER BY u.id LIMIT 1`,
        [exameItem, est],
      );
      return r ? texto(r['login']) : null;
    });
  }

  profissionais(c: ContextoSadt, termo: string) {
    return this.ler(c, async (l) =>
      (
        await l.consultar(
          `SELECT ic.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome, cc.sigla, uf.sigla AS uf, ic.numero_inscricao,
                  COALESCE(oc.codigo_cbo, '') AS cbo
             FROM profissional pr
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
             JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
             JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
             LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
             LEFT JOIN ocupacao_cbo oc ON oc.id = ic.ocupacao_cbo_id
            WHERE pr.excluido_em IS NULL AND (pf.nome LIKE ? OR pr.nome_exibicao LIKE ? OR ic.numero_inscricao = ?)
            ORDER BY nome, ic.id LIMIT 50`,
          [`%${termo}%`, `%${termo}%`, termo],
          { teto: 50 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['nome']),
        conselho: `${texto(r['sigla'])} ${texto(r['numero_inscricao'])}${r['uf'] ? `/${texto(r['uf'])}` : ''}`,
        cbo: texto(r['cbo']),
      })),
    );
  }

  // O cadastro unificado em outro não entra na escolha: o pedido novo nasce no cadastro que continua (02-CAD linha 20).
  solicitantes(c: ContextoSadt, o: { termo?: string; numero?: number; uf?: string }) {
    return this.ler(c, async (l) => {
      const p: unknown[] = [];
      let f = '';
      if (o.termo) {
        f += ' AND s.nome LIKE ?';
        p.push(`%${o.termo}%`);
      }
      if (o.numero) {
        f += ' AND s.numero_conselho = ?';
        p.push(String(o.numero));
      }
      if (o.uf) {
        f += ' AND uf.sigla = ?';
        p.push(o.uf);
      }
      return (
        await l.consultar(
          `SELECT s.id, s.nome, cc.sigla, s.numero_conselho, uf.sigla AS uf, s.ativo
             FROM solicitante_externo s
             JOIN conselho_classe cc ON cc.id = s.conselho_classe_id
             JOIN unidade_federativa uf ON uf.id = s.conselho_unidade_federativa_id
            WHERE s.excluido_em IS NULL AND s.sucessor_solicitante_externo_id IS NULL ${f}
            ORDER BY s.nome, s.id LIMIT 50`,
          p,
          { teto: 50 },
        )
      ).map((r) => ({
        id: n(r['id']),
        nome: texto(r['nome']),
        registro: `${texto(r['sigla'])} ${texto(r['numero_conselho'])}/${texto(r['uf'])}`,
        ativo: verdadeiro(r['ativo']),
      }));
    });
  }

  /**
   * Os parâmetros do SADT (parametro_definicao `sadt.*`) com o valor efetivo: o do usuário antes do do estabelecimento,
   * e este antes do da rede; sem valor, o padrão da definição. Os do setor (`sadt.<setor>.*`) só aparecem no próprio
   * setor. O modelo não guarda segredo em parâmetro (credencial vai ao cofre): não há campo oculto a listar.
   */
  parametros(c: ContextoSadt, setor: SetorSadt, usuario: string) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT d.chave, d.descricao, d.valor_padrao,
                (SELECT v.valor FROM parametro_valor v LEFT JOIN usuario u ON u.id = v.usuario_id
                  WHERE v.parametro_definicao_id = d.id AND v.vigencia_inicio <= NOW()
                    AND (v.vigencia_fim IS NULL OR v.vigencia_fim > NOW())
                    AND ((v.nivel = 'usuario' AND u.login = ?) OR (v.nivel = 'estabelecimento' AND v.estabelecimento_id = ?)
                         OR v.nivel = 'rede')
                  ORDER BY FIELD(v.nivel, 'usuario', 'estabelecimento', 'rede'), v.vigencia_inicio DESC LIMIT 1) AS valor
           FROM parametro_definicao d
          WHERE d.ativo = TRUE AND d.chave LIKE 'sadt.%' ORDER BY d.chave`,
        [usuario, est],
        { teto: 1000 },
      );
      const outros = SETORES_SADT.map((s) => s.codigo).filter((s) => s !== setor);
      return {
        campos: ls
          .filter((r) => !outros.some((s) => texto(r['chave']).startsWith(`sadt.${s}.`)))
          .map((r) => ({
            campo: texto(r['chave']),
            rotulo: texto(r['descricao']),
            valor: texto(r['valor'] ?? r['valor_padrao']),
          })),
        ocultos: [],
      };
    });
  }

  /**
   * O tempo de atendimento do período (regra 12), agregado no banco: do pedido à liberação, do pedido à coleta (o
   * primeiro evento "coletada" do rastreio) e da coleta à liberação, cada média com quantos exames entram nela; o
   * pendente há mais de 24 h pela hora do estabelecimento; e a visualização no portal das liberações publicadas.
   */
  indicadores(
    c: ContextoSadt,
    o: { inicio: string; fim: string; setor?: SetorSadt | undefined; agora: Date },
  ) {
    return this.ler(c, async (l, est) => {
      const { agora } = await this.hoje(l, est);
      const tipos = o.setor ? TIPOS_DO_SETOR[o.setor] : TIPOS_SADT;
      const base = `
        SELECT sd.tipo, CASE WHEN ei.urgente = TRUE OR r.prioridade <> 'rotina' THEN 'urgente' ELSE 'rotina' END AS prioridade,
               r.solicitado_em AS s, ei.liberado_em AS l, ei.situacao IN ('liberado', 'entregue') AS lib,
               (SELECT MIN(ev.ocorrido_em) FROM amostra_biologica_exame abe
                  JOIN amostra_biologica_evento ev ON ev.amostra_biologica_id = abe.amostra_biologica_id
                 WHERE abe.exame_item_id = ei.id AND abe.excluido_em IS NULL AND ev.evento = 'coletada') AS c,
               EXISTS (SELECT 1 FROM liberacao_resultado_portal lp JOIN resultado_exame re ON re.id = lp.resultado_exame_id
                        WHERE re.exame_item_id = ei.id AND lp.primeira_visualizacao_em IS NOT NULL) AS vis
          FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id)
         WHERE r.estabelecimento_id = ? AND r.excluido_em IS NULL AND ei.excluido_em IS NULL
           AND ei.situacao NOT IN ('cancelado', 'recusado')
           AND r.solicitado_em >= ? AND r.solicitado_em < DATE_ADD(?, INTERVAL 1 DAY) AND sd.tipo IN (${lista(tipos.length)})`;
      const p = [est, o.inicio, o.fim, ...tipos];
      const pl = 'x.lib AND x.l IS NOT NULL AND x.l >= x.s';
      const pc = 'x.c IS NOT NULL AND x.c >= x.s';
      const cl = `${pc} AND x.lib AND x.l IS NOT NULL AND x.l > x.c`;
      const linhas = await l.consultar(
        `SELECT x.tipo, x.prioridade, COUNT(*) AS exames, SUM(x.lib) AS liberados,
                SUM(${pl}) AS com_marcas, ROUND(AVG(CASE WHEN ${pl} THEN TIMESTAMPDIFF(SECOND, x.s, x.l) / 60 END)) AS media_pl,
                SUM(${pc}) AS com_coleta, ROUND(AVG(CASE WHEN ${pc} THEN TIMESTAMPDIFF(SECOND, x.s, x.c) / 60 END)) AS media_pc,
                SUM(${cl}) AS com_cl, ROUND(AVG(CASE WHEN ${cl} THEN TIMESTAMPDIFF(SECOND, x.c, x.l) / 60 END)) AS media_cl
           FROM (${base}) x GROUP BY x.tipo, x.prioridade ORDER BY x.tipo, x.prioridade`,
        p,
        { teto: 100 },
      );
      const dias = await l.consultar(
        `SELECT DATE(x.s) AS dia, COUNT(*) AS exames FROM (${base}) x GROUP BY DATE(x.s) ORDER BY dia`,
        p,
        { teto: 400 },
      );
      const tot = await l.uma(
        `SELECT COALESCE(SUM(NOT x.lib AND x.s < DATE_SUB(?, INTERVAL 24 HOUR)), 0) AS pendentes,
                COALESCE(SUM(x.lib), 0) AS liberados, COALESCE(SUM(x.lib AND x.vis), 0) AS visualizados
           FROM (${base}) x`,
        [agora.replace('T', ' '), ...p],
      );
      return {
        linhas: linhas.map((r) => {
          const comMarcas = n(r['com_marcas']);
          return {
            setor: setorDoTipo(texto(r['tipo'])) ?? 'laboratorio',
            prioridade: texto(r['prioridade']) === 'urgente' ? ('urgente' as const) : ('rotina' as const),
            exames: n(r['exames']),
            liberados: n(r['liberados']),
            mediaMinutosPedidoLiberacao: nn(r['media_pl']),
            comMarcas,
            semMarcas: n(r['liberados']) - comMarcas,
            mediaMinutosPedidoColeta: nn(r['media_pc']),
            comColeta: n(r['com_coleta']),
            mediaMinutosColetaLiberacao: nn(r['media_cl']),
            comColetaLiberacao: n(r['com_cl']),
          };
        }),
        porDia: dias.map((r) => ({ dia: dataIso(r['dia']) ?? '', exames: n(r['exames']) })),
        pendentesMais24h: n(tot?.['pendentes']),
        visualizadosPortal: { liberados: n(tot?.['liberados']), visualizados: n(tot?.['visualizados']) },
      };
    });
  }

  // ── Portal de resultados: os laudos publicados (liberacao_resultado_portal) ─────────────────────────────────

  laudosPortalDoPaciente(
    c: ContextoSadt,
    o: { paciente: number; reg: number | null; atos: readonly number[] },
  ) {
    return this.ler(c, async (l, est) => {
      const { agora } = await this.hoje(l, est);
      const p: unknown[] = [est, agora.replace('T', ' '), o.paciente];
      let f = ' AND r.paciente_id = ?';
      if (o.reg !== null) {
        f += ' AND r.atendimento_id = ?';
        p.push(o.reg);
      }
      return laudosDoPortal(l, f, p, o.atos, false);
    });
  }

  laudosPortalDoMedico(c: ContextoSadt, o: { solicitante: number; atos: readonly number[]; desde: string }) {
    return this.ler(c, async (l, est) => {
      const { agora } = await this.hoje(l, est);
      return laudosDoPortal(
        l,
        ' AND r.solicitante_profissional_id = ? AND lp.liberado_em >= ?',
        [est, agora.replace('T', ' '), o.solicitante, o.desde],
        o.atos,
        true,
      );
    });
  }

  laudoPortal(c: ContextoSadt, liberacao: number): Promise<LaudoPortalLido | null> {
    return this.ler(c, async (l, est) => {
      const { agora } = await this.hoje(l, est);
      const [r] = await l.consultar(
        `${SQL_LAUDO_PORTAL} AND lp.id = ?`,
        [est, agora.replace('T', ' '), liberacao],
        { teto: 1 },
      );
      if (!r) return null;
      const valores = await valoresDosResultados(l, [n(r['resultado'])]);
      return {
        laudo: laudoDoPortal(r, true),
        ato: atoDoPortal(r),
        paciente: n(r['paciente_id']),
        reg: n(r['atendimento_id']),
        solicitante: nn(r['solicitante_profissional_id']),
        valores: valores.get(n(r['resultado'])) ?? [],
        texto: linhasDoLaudo(r),
      };
    });
  }

  pacienteDoAtendimento(c: ContextoSadt, reg: number) {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `SELECT p.id, pf.nome, pf.data_nascimento FROM atendimento a JOIN paciente p ON p.id = a.paciente_id
           JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id WHERE a.id = ? AND a.estabelecimento_id = ?`,
        [reg, est],
      );
      return r
        ? { paciente: n(r['id']), nome: texto(r['nome']), nascimento: dataIso(r['data_nascimento']) }
        : null;
    });
  }

  nascimentoDoPaciente(c: ContextoSadt, paciente: number) {
    // O paciente é do cliente inteiro (cadastro único).
    return this.ler(c, async (l) => {
      const r = await l.uma(
        `SELECT pf.nome, pf.data_nascimento FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id = ? AND p.excluido_em IS NULL`,
        [paciente],
      );
      return r ? { nome: texto(r['nome']), nascimento: dataIso(r['data_nascimento']) } : null;
    });
  }

  acessoPorProtocolo(c: ContextoSadt, resumo: string): Promise<AcessoPortalLido | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(`${SQL_ACESSO_PROTOCOLO} AND pa.resumo_protocolo = ?`, [est, resumo]);
      return r ? acessoDoProtocoloLido(r) : null;
    });
  }
  /** A conta do médico externo pela inscrição (conselho, UF e número); sem conta, o autocadastro mais recente. */
  acessoDoMedico(
    c: ContextoSadt,
    m: { conselho: string; uf: string; numero: string },
  ): Promise<AcessoPortalLido | null> {
    return this.ler(c, async (l, est) => {
      const r = await l.uma(
        `${SQL_ACESSO_MEDICO} AND cc.sigla = ? AND uf.sigla = ? AND pv.numero_conselho = ?
          ORDER BY cp.id IS NULL, pv.solicitado_em DESC, pv.id DESC LIMIT 1`,
        [est, m.conselho, m.uf, m.numero],
      );
      return r ? acessoDoMedicoLido(r) : null;
    });
  }
  acessoPorId(c: ContextoSadt, id: number): Promise<AcessoPortalLido | null> {
    const k = chaveAcessoPortal(id);
    return this.ler(c, async (l, est) => {
      const r =
        k.tipo === 'protocolo'
          ? await l.uma(`${SQL_ACESSO_PROTOCOLO} AND pa.id = ?`, [est, k.id])
          : await l.uma(`${SQL_ACESSO_MEDICO} AND ${k.tipo === 'conta' ? 'cp.id' : 'pv.id'} = ? LIMIT 1`, [
              est,
              k.id,
            ]);
      if (!r) return null;
      if (k.tipo === 'protocolo') return acessoDoProtocoloLido(r);
      const a = acessoDoMedicoLido(r);
      return a.id === id ? a : null;
    });
  }
  /**
   * Os autocadastros de médicos externos (pedido_vinculo_profissional_externo) do estabelecimento desde a data, com a
   * situação da conta aprovada e os candidatos: os profissionais do cadastro com a mesma inscrição (conselho, UF e
   * número), que a aprovação liga à conta do portal.
   */
  autocadastros(c: ContextoSadt, o: { desde: string }): Promise<AutocadastroPortalLido[]> {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT pv.id, pv.nome, cc.sigla AS conselho, uf.sigla AS uf, pv.numero_conselho, pv.situacao, pv.solicitado_em,
                pv.conselho_classe_id, pv.conselho_unidade_federativa_id, cp.situacao AS situacao_conta
           FROM pedido_vinculo_profissional_externo pv
           JOIN conselho_classe cc ON cc.id = pv.conselho_classe_id
           JOIN unidade_federativa uf ON uf.id = pv.conselho_unidade_federativa_id
           LEFT JOIN conta_portal_profissional_externo cp ON cp.id = pv.conta_portal_profissional_externo_id
          WHERE pv.estabelecimento_id = ? AND pv.excluido_em IS NULL AND pv.situacao <> 'cancelado' AND pv.solicitado_em >= ?
          ORDER BY pv.solicitado_em DESC, pv.id DESC LIMIT 500`,
        [est, o.desde],
        { teto: 500 },
      );
      const numeros = [...new Set(ls.map((r) => texto(r['numero_conselho'])))];
      const candidatos = new Map<string, { id: number; nome: string }[]>();
      if (numeros.length)
        for (const r of await l.consultar(
          `SELECT ic.conselho_classe_id, ic.unidade_federativa_id, ic.numero_inscricao, pr.id, COALESCE(pr.nome_exibicao, pf.nome) AS nome
             FROM inscricao_conselho ic JOIN profissional pr ON pr.id = ic.profissional_id AND pr.excluido_em IS NULL
             JOIN pessoa_fisica pf ON pf.id = pr.pessoa_fisica_id
            WHERE ic.excluido_em IS NULL AND ic.numero_inscricao IN (${lista(numeros.length)})
            ORDER BY nome, pr.id`,
          numeros,
          { teto: 5000 },
        )) {
          const k = `${n(r['conselho_classe_id'])}:${n(r['unidade_federativa_id'])}:${texto(r['numero_inscricao'])}`;
          const v = candidatos.get(k) ?? [];
          if (!v.some((x) => x.id === n(r['id']))) v.push({ id: n(r['id']), nome: texto(r['nome']) });
          candidatos.set(k, v);
        }
      return ls.map((r) => {
        const sit = texto(r['situacao']);
        const conta = r['situacao_conta'] === null ? null : texto(r['situacao_conta']);
        return {
          id: n(r['id']),
          nome: texto(r['nome']),
          conselho: texto(r['conselho']),
          uf: texto(r['uf']),
          numero: texto(r['numero_conselho']),
          situacao:
            sit === 'aprovado'
              ? ('aprovado' as const)
              : sit === 'recusado'
                ? ('recusado' as const)
                : ('pendente' as const),
          ...(conta === null ? {} : { situacaoConta: SITUACAO_DA_CONTA[conta] ?? conta }),
          pedidoEm: instante(r['solicitado_em']),
          origem: 'novo' as const,
          candidatos:
            candidatos.get(
              `${n(r['conselho_classe_id'])}:${n(r['conselho_unidade_federativa_id'])}:${texto(r['numero_conselho'])}`,
            ) ?? [],
        };
      });
    });
  }

  atosPublicados(c: ContextoSadt) {
    return this.ler(c, async (l, est) => {
      const ls = await l.consultar(
        `SELECT DISTINCT sd.tipo, mi.sigla_padrao
           FROM setor_publicado_portal sp
           JOIN setor_diagnostico sd ON sd.id = sp.setor_diagnostico_id
           LEFT JOIN exame e ON e.id = sp.exame_id
           LEFT JOIN modalidade_imagem mi ON mi.id = e.modalidade_imagem_id
          WHERE sp.estabelecimento_id = ? AND sp.ativo = TRUE AND sp.publica_laudo = TRUE`,
        [est],
      );
      const atos = new Set<number>();
      for (const r of ls) {
        const tipo = texto(r['tipo']);
        if (tipo === 'imagem' && r['sigla_padrao'] === null)
          for (const a of [16, 24, 25, 26, 27, 42]) atos.add(a);
        else atos.add(atoDoExame(tipo, r['sigla_padrao'] === null ? null : texto(r['sigla_padrao'])));
      }
      return [...atos].sort((a, b) => a - b);
    });
  }
}

/** amostra_biologica_evento.evento → estado da amostra das telas. */
function estadoDoEvento(evento: string): EstadoAmostra {
  switch (evento) {
    case 'coletada':
      return 'coletada';
    case 'enviada':
      return 'emTransporte';
    case 'recebida':
    case 'triada':
    case 'aliquotada':
      return 'recebida';
    case 'em_analise':
    case 'analisada':
    case 'armazenada':
      return 'emAnalise';
    case 'cancelada':
      return 'recoleta';
    default:
      return 'rejeitada';
  }
}

/** O gravador sobre a transação da operação (o estabelecimento do contexto). */
function gravadorSobre(tx: TxOperacao, est: number): GravadorSghSadt {
  const usuario = tx.contexto.usuario;
  const agora = () => new Date();
  /** A data de hoje na hora do estabelecimento (as colunas DATE da gravação). */
  const hojeDoEstabelecimento = async () => {
    const f = await tx.uma('SELECT fuso_horario FROM estabelecimento WHERE id = ?', [est]);
    return relogioNoFuso(texto(f?.['fuso_horario']) || FUSO_PADRAO).hoje;
  };
  return {
    async registrarColeta(a) {
      if (a.exames.length === 0) throw recusa('sem-exames', 'Escolha ao menos um exame para coletar.');
      const ids = a.exames.map((x) => x.id);
      const itens = await tx.consultarParaAtualizar(
        `SELECT ei.id, ei.versao, ei.situacao, ei.requisicao_exame_id, ei.material_biologico_id, ei.recipiente_coleta_id,
                COALESCE(ei.setor_diagnostico_id, r.setor_diagnostico_id) AS setor, e.id AS exame_id
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id JOIN exame e ON e.id = ei.exame_id
          WHERE r.estabelecimento_id = ? AND r.paciente_id = ? AND ei.excluido_em IS NULL AND ei.id IN (${lista(ids.length)})`,
        [est, a.paciente, ...ids],
      );
      if (itens.length !== new Set(ids).size)
        throw recusa('exame-inexistente', 'Algum exame não é deste paciente neste estabelecimento.');
      const [ja] = await tx.consultar(
        `SELECT abe.exame_item_id FROM amostra_biologica_exame abe JOIN amostra_biologica am ON am.id = abe.amostra_biologica_id
          WHERE abe.excluido_em IS NULL AND am.excluido_em IS NULL AND am.situacao NOT IN ('rejeitada', 'cancelada', 'descartada')
            AND abe.exame_item_id IN (${lista(ids.length)}) LIMIT 1`,
        ids,
      );
      if (ja)
        throw recusa(
          'amostra-coletada',
          'O exame já tem amostra coletada: rejeite a anterior para coletar de novo.',
        );
      const primeiro = itens[0]!;
      let material = nn(primeiro['material_biologico_id']);
      if (material === null) {
        const m = await tx.uma(
          `SELECT em.material_biologico_id FROM exame_material em WHERE em.exame_id = ? ORDER BY em.id LIMIT 1`,
          [n(primeiro['exame_id'])],
        );
        material = nn(m?.['material_biologico_id']);
      }
      if (material === null) throw recusa('sem-material', 'O exame não tem material de coleta no cadastro.');
      // O posto escolhido é do estabelecimento e está ativo; fora do horário, a coleta segue com o aviso gravado.
      const avisosPosto = await conferirPostoDaColeta(tx, est, a.posto ?? null);
      const coletada = agora();
      const provisorio = `C${randomUUID().replace(/-/g, '').slice(0, 20).toUpperCase()}`;
      const id = await tx.incluir('amostra_biologica', {
        estabelecimento_id: est,
        codigo_barras: provisorio,
        requisicao_exame_id: n(primeiro['requisicao_exame_id']),
        material_biologico_id: material,
        recipiente_coleta_id: a.recipiente ?? nn(primeiro['recipiente_coleta_id']),
        setor_diagnostico_id: nn(primeiro['setor']),
        ponto_coleta_id: a.posto ?? null,
        situacao: 'coletada',
        coletada_em: coletada,
        coletada_no_setor: false,
        coleta_domiciliar: false,
        coleta_externa: false,
        repeticao: false,
        origem: 'sistema',
      });
      const codigo = a.codigo(id);
      await tx.alterar('amostra_biologica', id, 1, { codigo_barras: codigo });
      for (const i of itens) {
        await tx.incluir('amostra_biologica_exame', { amostra_biologica_id: id, exame_item_id: n(i['id']) });
        if (['solicitado', 'autorizado', 'agendado'].includes(texto(i['situacao'])))
          await tx.alterar('exame_item', n(i['id']), n(i['versao']), {
            situacao: 'coletado',
            coletado_em: coletada,
          });
      }
      await tx.incluir('amostra_biologica_evento', {
        amostra_biologica_id: id,
        operacao: 'inclusao',
        evento: 'coletada',
        ocorrido_em: coletada,
        usuario_id: usuario,
        dados: JSON.stringify({
          pulseiraConferida: a.pulseiraConferida,
          estacao: a.estacao,
          posto: a.posto ?? null,
          avisosPosto,
        }),
      });
      return { id, codigo };
    },

    async mudarEstadoAmostra(r) {
      const [am] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM amostra_biologica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
        [r.amostra, est],
        { teto: 1 },
      );
      if (!am) throw recusa('amostra-inexistente', 'A amostra não existe neste estabelecimento.');
      if (estadoDaAmostra(texto(am['situacao'])) !== r.de) throw erroConflitoVersao(['situacao']);
      const para = SITUACAO_DA_AMOSTRA[r.para];
      if ((r.para === 'rejeitada' || r.para === 'recoleta') && !r.motivo)
        throw recusa('motivo-obrigatorio', 'Informe o motivo da rejeição da amostra.');
      const quando = agora();
      await tx.alterar('amostra_biologica', r.amostra, n(am['versao']), {
        situacao: para.situacao,
        ...(r.para === 'recebida' ? { recebida_em: quando, recebida_por_usuario_id: usuario } : {}),
      });
      await tx.incluir('amostra_biologica_evento', {
        amostra_biologica_id: r.amostra,
        operacao: 'alteracao',
        evento: para.evento,
        ocorrido_em: quando,
        usuario_id: usuario,
        descricao: r.motivo ?? r.detalhe,
        dados: JSON.stringify({ de: r.de, para: r.para, estacao: r.estacao }),
      });
      // O exame acompanha a amostra na análise (o item pedido passa a "em análise" ao entrar na bancada).
      if (r.para === 'recebida' || r.para === 'emAnalise') {
        const itens = await tx.consultarParaAtualizar(
          `SELECT ei.id, ei.versao FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
            WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao IN ('solicitado', 'autorizado', 'agendado', 'coletado')`,
          [r.amostra],
        );
        for (const i of itens)
          await tx.alterar('exame_item', n(i['id']), n(i['versao']), { situacao: 'em_analise' });
      }
      // A amostra rejeitada (ou cancelada para recoleta) devolve o exame ainda sem resultado à coleta.
      if (r.para === 'rejeitada' || r.para === 'recoleta') {
        const itens = await tx.consultarParaAtualizar(
          `SELECT ei.id, ei.versao FROM amostra_biologica_exame abe JOIN exame_item ei ON ei.id = abe.exame_item_id
            WHERE abe.amostra_biologica_id = ? AND abe.excluido_em IS NULL AND ei.situacao IN ('coletado', 'em_analise')`,
          [r.amostra],
        );
        for (const i of itens)
          await tx.alterar('exame_item', n(i['id']), n(i['versao']), { situacao: 'solicitado' });
      }
    },

    async gravarValorCritico(f) {
      const e = await tx.uma('SELECT id FROM exame WHERE codigo = ? AND excluido_em IS NULL', [f.exame]);
      if (!e) throw recusa('exame-inexistente', 'O exame não existe no catálogo.');
      if (f.abaixoDe === null && f.acimaDe === null)
        throw recusa('faixa-vazia', 'Informe o limite inferior, o superior ou os dois.');
      const hoje = agora();
      const anteriores = await tx.consultarParaAtualizar(
        `SELECT id, versao FROM regra_valor_critico
          WHERE estabelecimento_id = ? AND exame_id = ? AND analito_id <=> ? AND vigencia_fim IS NULL`,
        [est, n(e['id']), f.elemento || null],
      );
      // A regra vigente da unidade é encerrada (não apagada): o histórico da faixa fica. A regra da rede
      // (estabelecimento nulo) não é tocada: a nova regra da unidade a sobrepõe só nesta unidade.
      for (const a of anteriores)
        await tx.alterar('regra_valor_critico', n(a['id']), n(a['versao']), {
          vigencia_fim: hoje,
          ativo: false,
        });
      return tx.incluir('regra_valor_critico', {
        estabelecimento_id: est,
        exame_id: n(e['id']),
        analito_id: f.elemento || null,
        limite_inferior: f.abaixoDe,
        limite_superior: f.acimaDe,
        prazo_comunicacao_minutos: f.prazoMinutos,
        comunica_solicitante: true,
        comunica_plantonista: false,
        comunica_enfermagem: false,
        exige_confirmacao_leitura: true,
        tentativas_maximas: 3,
        intervalo_tentativa_minutos: 10,
        vigencia_inicio: hoje,
        ativo: f.ativo,
      });
    },

    async avisarCriticos(a) {
      // A porta lê o resultado, os analitos críticos, os avisos que já existem e as regras vigentes candidatas; quem
      // escolhe os alvos, a regra (unidade antes da rede, analito antes do exame) e o prazo é o domínio
      // (@sgh/dominio-sadt, critico/regra-aviso). Avisar de novo o mesmo resultado não repete o aviso.
      const [re] = await tx.consultarParaAtualizar<Linha>(
        `SELECT re.id, re.critico, ei.exame_id, r.paciente_id
           FROM resultado_exame re
           JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE re.id = ? AND re.exame_item_id = ? AND r.estabelecimento_id = ? AND re.situacao = 'liberado'
            AND re.excluido_em IS NULL`,
        [a.idLiberacao, a.exameItem, est],
      );
      if (!re) throw recusa('liberacao-inexistente', 'A liberação do exame não está neste estabelecimento.');
      const resultado = n(re['id']);
      const exame = n(re['exame_id']);
      const criticos = (
        await tx.consultar<Linha>(
          `SELECT id, analito_id FROM resultado_analito
            WHERE resultado_exame_id = ? AND critico = TRUE AND excluido_em IS NULL ORDER BY sequencia, id`,
          [resultado],
        )
      ).map((x) => ({ analito: nn(x['analito_id']), resultadoAnalito: n(x['id']) }));
      const ja = new Set(
        (
          await tx.consultar<Linha>(
            'SELECT resultado_analito_id AS ra FROM aviso_valor_critico WHERE resultado_exame_id = ? AND excluido_em IS NULL',
            [resultado],
          )
        ).map((x) => nn(x['ra'])),
      );
      const alvos = alvosDoAviso(criticos, verdadeiro(re['critico']), ja);
      if (!alvos.length) return 0;
      const gerado = agora();
      const analitos = [...new Set(alvos.map((x) => x.analito).filter((x): x is number => x !== null))];
      const candidatas: RegraCriticoCandidata[] = (
        await tx.consultar<Linha>(
          `SELECT id, estabelecimento_id, analito_id, exame_id, prazo_comunicacao_minutos FROM regra_valor_critico
            WHERE (estabelecimento_id = ? OR estabelecimento_id IS NULL) AND ativo = TRUE
              AND vigencia_inicio <= ? AND (vigencia_fim IS NULL OR vigencia_fim >= ?)
              AND (exame_id = ?${analitos.length ? ` OR analito_id IN (${analitos.map(() => '?').join(', ')})` : ''})`,
          [est, gerado, gerado, exame, ...analitos],
        )
      ).map((x) => ({
        id: n(x['id']),
        estabelecimento: nn(x['estabelecimento_id']),
        analito: nn(x['analito_id']),
        exame: nn(x['exame_id']),
        prazoMinutos: nn(x['prazo_comunicacao_minutos']),
      }));
      for (const x of alvos) {
        const aviso = avisoDoAlvo(candidatas, { estabelecimento: est, exame, analito: x.analito }, gerado);
        await tx.incluir('aviso_valor_critico', {
          estabelecimento_id: est,
          resultado_exame_id: resultado,
          resultado_analito_id: x.resultadoAnalito,
          paciente_id: n(re['paciente_id']),
          regra_valor_critico_id: aviso.regra,
          gerado_em: gerado,
          prazo_em: aviso.prazoEm,
          situacao: 'pendente',
          nivel_escalonamento: 0,
        });
      }
      return alvos.length;
    },

    async comunicarAviso(r) {
      const [a] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, nivel_escalonamento FROM aviso_valor_critico WHERE id = ? AND estabelecimento_id = ?',
        [r.aviso, est],
        { teto: 1 },
      );
      if (!a) throw recusa('aviso-inexistente', 'O aviso não existe neste estabelecimento.');
      if (['comunicado', 'leitura_confirmada', 'cancelado'].includes(texto(a['situacao'])))
        throw recusa('aviso-comunicado', 'O aviso já foi comunicado.');
      const canal = await tx.uma('SELECT id FROM canal_notificacao WHERE codigo = ? AND ativo = TRUE', [
        r.canal,
      ]);
      if (!canal) throw recusa('canal-inexistente', 'O canal de comunicação não está cadastrado.');
      const [seq] = await tx.consultar(
        'SELECT COALESCE(MAX(sequencia), 0) + 1 AS s FROM aviso_valor_critico_tentativa WHERE aviso_valor_critico_id = ?',
        [r.aviso],
      );
      const quando = agora();
      await tx.incluir('aviso_valor_critico_tentativa', {
        aviso_valor_critico_id: r.aviso,
        operacao: 'inclusao',
        ocorrido_em: quando,
        usuario_id: usuario,
        sequencia: n(seq?.['s']),
        canal_notificacao_id: n(canal['id']),
        destinatario_descricao: r.destinatario.slice(0, 150),
        nivel_escalonamento: n(a['nivel_escalonamento']),
        resultado: 'comunicado',
        observacao: r.observacao?.slice(0, 500) ?? null,
      });
      await tx.alterar('aviso_valor_critico', r.aviso, n(a['versao']), {
        situacao: 'comunicado',
        comunicado_descricao: r.destinatario.slice(0, 150),
        comunicado_em: quando,
        comunicado_por_usuario_id: usuario,
        observacao: r.observacao,
      });
    },

    async escalonarAviso(r) {
      const [a] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao, nivel_escalonamento FROM aviso_valor_critico WHERE id = ? AND estabelecimento_id = ?',
        [r.aviso, est],
        { teto: 1 },
      );
      if (!a || !['pendente', 'em_contato', 'escalonado'].includes(texto(a['situacao']))) return false;
      if (n(a['nivel_escalonamento']) >= r.nivel) return false;
      await tx.alterar('aviso_valor_critico', r.aviso, n(a['versao']), {
        nivel_escalonamento: r.nivel,
        situacao: 'escalonado',
      });
      return true;
    },

    async registrarLeitura(r) {
      // A leitura no portal (paciente ou médico externo, sem usuário interno) vai à publicação vigente do resultado no
      // portal (não vencida, como na leitura). Todo acesso fica no registro de acessos (auditoria do acesso a dado de
      // saúde) e soma uma visualização; a primeira abertura marca também a publicação.
      if (r.origem === 'portal') {
        const quando = agora();
        const [lp] = await tx.consultarParaAtualizar(
          `SELECT lp.id, lp.versao, lp.primeira_visualizacao_em, lp.visualizacoes FROM liberacao_resultado_portal lp
             JOIN resultado_exame re ON re.id = lp.resultado_exame_id
            WHERE re.exame_item_id = ? AND lp.estabelecimento_id = ? AND lp.situacao = 'liberado' AND lp.excluido_em IS NULL
              AND (lp.disponivel_ate IS NULL OR lp.disponivel_ate > ?)
            ORDER BY lp.liberado_em DESC, lp.id DESC LIMIT 1`,
          [r.exameItem, est, quando],
          { teto: 1 },
        );
        if (!lp) throw recusa('resultado-nao-publicado', 'O resultado não está publicado no portal.');
        await tx.incluir('acesso_resultado_portal', {
          liberacao_resultado_portal_id: n(lp['id']),
          operacao: 'inclusao',
          ocorrido_em: quando,
          usuario_id: usuario,
          tipo_acesso: 'visualizacao',
        });
        await tx.alterar('liberacao_resultado_portal', n(lp['id']), n(lp['versao']), {
          ...(lp['primeira_visualizacao_em'] === null ? { primeira_visualizacao_em: quando } : {}),
          visualizacoes: n(lp['visualizacoes']) + 1,
        });
        return;
      }
      if (usuario === null) throw recusa('sem-usuario', 'A leitura do resultado exige o usuário da sessão.');
      const re = await tx.uma(
        `SELECT re.id, re.paciente_id FROM resultado_exame re JOIN exame_item ei ON ei.id = re.exame_item_id
           JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id
          WHERE re.exame_item_id = ? AND q.estabelecimento_id = ? AND re.situacao = 'liberado' AND re.excluido_em IS NULL`,
        [r.exameItem, est],
      );
      if (!re)
        throw recusa('resultado-inexistente', 'O resultado liberado não existe neste estabelecimento.');
      // Só a primeira abertura por usuário (uq_visualizacao_resultado_exame_usuario): a repetida não grava.
      const ja = await tx.uma(
        'SELECT id FROM visualizacao_resultado_exame WHERE resultado_exame_id = ? AND usuario_id = ?',
        [n(re['id']), usuario],
      );
      if (ja) return;
      await tx.incluir('visualizacao_resultado_exame', {
        estabelecimento_id: est,
        resultado_exame_id: n(re['id']),
        paciente_id: n(re['paciente_id']),
        usuario_id: usuario,
        visualizado_em: agora(),
        origem: 'sistema',
      });
    },

    async marcarOrcamentoConvertido(r) {
      const hoje = await hojeDoEstabelecimento();
      const [o] = await tx.consultarParaAtualizar(
        `SELECT op.id, op.versao, op.situacao, op.paciente_id, op.aceito_em, op.validade_ate < ? AS vencido
           FROM orcamento_particular op
          WHERE op.id = ? AND op.estabelecimento_id = ? AND op.excluido_em IS NULL
            AND EXISTS (SELECT 1 FROM orcamento_particular_item oi WHERE oi.orcamento_particular_id = op.id
                           AND oi.tipo_item = 'exame' AND oi.excluido_em IS NULL)`,
        [hoje, r.orcamento, est],
        { teto: 1 },
      );
      // Só o orçamento do diagnóstico (com item de exame) se converte por aqui; o de internação ou outro não existe nesta porta.
      if (!o)
        throw recusa('orcamento-inexistente', 'O orçamento de exames não existe neste estabelecimento.');
      if (texto(o['situacao']) === 'realizado')
        throw recusa('orcamento-convertido', 'O orçamento já foi convertido.');
      // O rascunho converte: no setor o orçamento é feito e aceito no balcão, e a conversão registra o aceite (aceito_em).
      // Vencido pela data (validade antes de hoje no fuso do estabelecimento) não converte, como a leitura o mostra.
      if (!['rascunho', 'emitido', 'aceito'].includes(texto(o['situacao'])) || verdadeiro(o['vencido']))
        throw recusa('orcamento-indisponivel', 'O orçamento recusado, vencido ou cancelado não se converte.');
      const a = await tx.uma(
        "SELECT id, paciente_id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND situacao <> 'cancelado'",
        [r.atendimento, est],
      );
      if (!a) throw recusa('atendimento-inexistente', 'O atendimento não existe neste estabelecimento.');
      if (o['paciente_id'] !== null && n(o['paciente_id']) !== n(a['paciente_id']))
        throw recusa('paciente-divergente', 'O orçamento é de outro paciente.');
      const quando = agora();
      await tx.alterar('orcamento_particular', r.orcamento, n(o['versao']), {
        situacao: 'realizado',
        atendimento_id: r.atendimento,
        aceito_em: o['aceito_em'] ?? quando,
        realizado_em: hoje,
      });
    },

    /** O número do laudo (F3.5): a numeração do estabelecimento (semeada na migração e no "criar novo cliente"). */
    async reservarNumeroLaudo() {
      return numeroDoLaudo(await tx.proximoNumero(SEQUENCIA_NUMERO_LAUDO));
    },

    async registrarLaudoEmitido(r) {
      const ids = r.idsExames ?? [];
      if (ids.length === 0) throw recusa('sem-exames', 'O laudo emitido precisa dos exames.');
      const itens = await tx.consultar(
        `SELECT ei.id, r.paciente_id, r.id AS requisicao,
                (SELECT MAX(re.id) FROM resultado_exame re WHERE re.exame_item_id = ei.id AND re.situacao = 'liberado') AS resultado
           FROM exame_item ei JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id
          WHERE r.estabelecimento_id = ? AND ei.id IN (${lista(ids.length)})`,
        [est, ...ids],
      );
      if (itens.length !== new Set(ids).size)
        throw recusa('exame-inexistente', 'Algum exame não é deste estabelecimento.');
      if (new Set(itens.map((i) => n(i['paciente_id']))).size > 1)
        throw recusa('pacientes-diferentes', 'O laudo reúne exames de um paciente só.');
      if (r.via > 1 && !r.motivo) throw recusa('motivo-obrigatorio', 'Informe o motivo da segunda via.');
      // A segunda via leva o motivo do cadastro (motivo_reimpressao, pelo código ou pela descrição escolhida na tela).
      let motivo: number | null = null;
      if (r.via > 1) {
        const mr = await tx.uma(
          'SELECT id FROM motivo_reimpressao WHERE (codigo = ? OR descricao = ?) AND ativo = TRUE ORDER BY id LIMIT 1',
          [r.motivo, r.motivo],
        );
        if (!mr) throw recusa('motivo-nao-cadastrado', 'Escolha um motivo de segunda via do cadastro.');
        motivo = n(mr['id']);
      }
      const quando = agora();
      // A via seguinte é do MESMO laudo: a emissão original travada (vias em fila), o número e o código dela, e a via
      // seguinte à maior já gravada. A 1ª via leva o número reservado antes do PDF (reservarNumeroLaudo).
      let numero = r.numero;
      let via = 1;
      if (r.via > 1) {
        if (r.original === null) throw recusa('sem-primeira-via', 'A 2ª via é de um laudo já emitido.');
        const [o] = await tx.consultarParaAtualizar(
          `SELECT id, numero, codigo_autenticacao FROM emissao_laudo
            WHERE id = ? AND estabelecimento_id = ? AND emissao_original_id IS NULL AND excluido_em IS NULL`,
          [r.original, est],
          { teto: 1 },
        );
        if (!o || texto(o['codigo_autenticacao']) !== r.codigo || texto(o['numero']) !== r.numero)
          throw recusa('sem-primeira-via', 'A 2ª via é do mesmo laudo da 1ª: número e código dela.');
        numero = texto(o['numero']);
        const ult = await tx.uma(
          'SELECT MAX(numero_via) AS v FROM emissao_laudo WHERE id = ? OR emissao_original_id = ?',
          [r.original, r.original],
        );
        via = n(ult?.['v']) + 1;
      }
      const id = await tx.incluir('emissao_laudo', {
        estabelecimento_id: est,
        numero,
        codigo_autenticacao: r.codigo,
        numero_via: via,
        emissao_original_id: via > 1 ? r.original : null,
        paciente_id: n(itens[0]!['paciente_id']),
        requisicao_exame_id: n(itens[0]!['requisicao']),
        tipo_emissao: r.via > 1 ? 'reimpressao' : 'pdf',
        motivo_reimpressao_id: motivo,
        laudo_gerado_em: quando,
        emitida_em: quando,
        emitido_por_usuario_id: usuario,
        origem: 'sistema',
      });
      let seq = 0;
      for (const i of itens)
        await tx.incluir('emissao_laudo_exame', {
          emissao_laudo_id: id,
          sequencia: ++seq,
          exame_item_id: n(i['id']),
          resultado_exame_id: nn(i['resultado']),
          origem: 'sistema',
        });
      if (r.via === 1)
        for (const i of itens) {
          const v = await tx.uma('SELECT versao FROM exame_item WHERE id = ?', [n(i['id'])]);
          await tx.alterar('exame_item', n(i['id']), n(v?.['versao']), { emitido_em: quando });
        }
      return { id, numero };
    },

    /** Um protocolo ativo por atendimento: o novo revoga o anterior (o código impresso antes deixa de valer). */
    async criarProtocoloPortal(r) {
      const at = await tx.uma(
        'SELECT id FROM atendimento WHERE id = ? AND estabelecimento_id = ? AND paciente_id = ?',
        [r.reg, est, r.paciente],
      );
      if (!at)
        throw recusa(
          'atendimento-inexistente',
          'O atendimento não existe neste estabelecimento para este paciente.',
        );
      if (!/^[0-9a-f]{64}$/.test(r.protocoloResumo))
        throw recusa('protocolo-invalido', 'O resumo do protocolo é inválido.');
      const quando = agora();
      for (const v of await tx.consultarParaAtualizar(
        `SELECT id, versao FROM protocolo_acesso_portal
          WHERE atendimento_id = ? AND estabelecimento_id = ? AND situacao = 'ativo' AND excluido_em IS NULL`,
        [r.reg, est],
      ))
        await tx.alterar('protocolo_acesso_portal', n(v['id']), n(v['versao']), {
          situacao: 'revogado',
          revogado_em: quando,
        });
      return tx.incluir('protocolo_acesso_portal', {
        estabelecimento_id: est,
        paciente_id: r.paciente,
        atendimento_id: r.reg,
        resumo_protocolo: r.protocoloResumo,
        situacao: 'ativo',
        tentativas_falhas: 0,
        emitido_em: quando,
        emitido_por_usuario_id: usuario,
        origem: 'sistema',
      });
    },

    /** O autocadastro do portal: um pedido em aberto por inscrição no estabelecimento; a senha e o fator já chegam protegidos. */
    async registrarAutocadastro(r) {
      const cc = await tx.uma('SELECT id FROM conselho_classe WHERE sigla = ? LIMIT 1', [r.conselho]);
      const uf = await tx.uma('SELECT id FROM unidade_federativa WHERE sigla = ? LIMIT 1', [r.uf]);
      if (!cc || !uf)
        throw recusa('inscricao-invalida', 'O conselho ou a UF da inscrição não existem no cadastro.');
      const [aberto] = await tx.consultarParaAtualizar(
        `SELECT pv.id FROM pedido_vinculo_profissional_externo pv
           LEFT JOIN conta_portal_profissional_externo cp ON cp.id = pv.conta_portal_profissional_externo_id AND cp.excluido_em IS NULL
          WHERE pv.estabelecimento_id = ? AND pv.conselho_classe_id = ? AND pv.conselho_unidade_federativa_id = ?
            AND pv.numero_conselho = ? AND pv.excluido_em IS NULL
            AND (pv.situacao IN ('pendente', 'em_conferencia') OR (pv.situacao = 'aprovado' AND cp.situacao IN ('pendente', 'ativa')))
          LIMIT 1`,
        [est, cc['id'], uf['id'], r.numero],
        { teto: 1 },
      );
      if (aberto)
        throw recusa('autocadastro-repetido', 'Já há um cadastro em análise ou ativo para esta inscrição.');
      return tx.incluir('pedido_vinculo_profissional_externo', {
        estabelecimento_id: est,
        nome: r.nome.slice(0, 150),
        cpf: r.cpf,
        email: r.email.slice(0, 254),
        conselho_classe_id: n(cc['id']),
        numero_conselho: r.numero.slice(0, 20),
        conselho_unidade_federativa_id: n(uf['id']),
        situacao: 'pendente',
        solicitado_em: agora(),
        resumo_senha: r.senhaResumo,
        segredo_segundo_fator_cifrado: r.segundoFator,
        origem: 'sistema',
      });
    },

    async decidirAutocadastro(r) {
      const [pv] = await tx.consultarParaAtualizar(
        `SELECT id, versao, situacao, email, conselho_classe_id, conselho_unidade_federativa_id, numero_conselho,
                resumo_senha, segredo_segundo_fator_cifrado
           FROM pedido_vinculo_profissional_externo WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
        [r.id, est],
        { teto: 1 },
      );
      if (!pv) throw recusa('autocadastro-inexistente', 'O autocadastro não existe neste estabelecimento.');
      if (!['pendente', 'em_conferencia'].includes(texto(pv['situacao'])))
        throw recusa('autocadastro-decidido', 'O autocadastro já foi decidido.');
      const quando = agora();
      if (!r.aprovar) {
        await tx.alterar('pedido_vinculo_profissional_externo', r.id, n(pv['versao']), {
          situacao: 'recusado',
          conferido_em: quando,
          conferido_por_usuario_id: usuario,
          motivo_recusa: r.motivo?.slice(0, 500) ?? null,
        });
        return;
      }
      // A aprovação liga o pedido ao profissional do cadastro com a mesma inscrição (conselho, UF e número).
      if (r.solicitante === null)
        throw recusa('solicitante-obrigatorio', 'Escolha o médico do cadastro que o pedido liga.');
      const pr = await tx.uma(
        `SELECT pr.id, pr.pessoa_fisica_id FROM profissional pr
           JOIN inscricao_conselho ic ON ic.profissional_id = pr.id AND ic.excluido_em IS NULL
          WHERE pr.id = ? AND pr.excluido_em IS NULL AND ic.conselho_classe_id = ? AND ic.unidade_federativa_id = ?
            AND ic.numero_inscricao = ? LIMIT 1`,
        [
          r.solicitante,
          pv['conselho_classe_id'],
          pv['conselho_unidade_federativa_id'],
          pv['numero_conselho'],
        ],
      );
      if (!pr) throw recusa('solicitante-divergente', 'O médico escolhido não tem a inscrição do pedido.');
      const [ja] = await tx.consultarParaAtualizar(
        'SELECT id, versao, situacao FROM conta_portal_profissional_externo WHERE profissional_id = ? AND excluido_em IS NULL',
        [r.solicitante],
        { teto: 1 },
      );
      let conta: number;
      if (ja) {
        conta = n(ja['id']);
        if (texto(ja['situacao']) === 'pendente')
          await tx.alterar('conta_portal_profissional_externo', conta, n(ja['versao']), {
            situacao: 'ativa',
            autorizada_em: quando,
            autorizada_por_usuario_id: usuario,
            // A credencial do pedido aprovado passa à conta (resumo e segredo cifrado, nunca em claro).
            resumo_senha: pv['resumo_senha'] ?? null,
            segredo_segundo_fator_cifrado: pv['segredo_segundo_fator_cifrado'] ?? null,
          });
      } else {
        const email = texto(pv['email']);
        if (await tx.uma('SELECT id FROM conta_portal_profissional_externo WHERE login = ?', [email]))
          throw recusa('login-em-uso', 'O e-mail do pedido já é o acesso de outra conta do portal.');
        conta = await tx.incluir('conta_portal_profissional_externo', {
          profissional_id: r.solicitante,
          pessoa_fisica_id: n(pr['pessoa_fisica_id']),
          pedido_vinculo_profissional_externo_id: r.id,
          login: email,
          email,
          situacao: 'ativa',
          autorizada_em: quando,
          autorizada_por_usuario_id: usuario,
          resumo_senha: pv['resumo_senha'] ?? null,
          segredo_segundo_fator_cifrado: pv['segredo_segundo_fator_cifrado'] ?? null,
          origem: 'sistema',
        });
      }
      await tx.alterar('pedido_vinculo_profissional_externo', r.id, n(pv['versao']), {
        situacao: 'aprovado',
        conferido_em: quando,
        conferido_por_usuario_id: usuario,
        conta_portal_profissional_externo_id: conta,
      });
    },
    /**
     * A tentativa de entrada: o protocolo, a conta e o autocadastro ainda sem conta guardam as falhas e o bloqueio. O
     * pedido conta também porque a senha dele passa à conta na aprovação: sem o contador, ela poderia ser testada sem
     * limite enquanto o pedido espera.
     */
    async registrarTentativaPortal(r) {
      const k = chaveAcessoPortal(r.id);
      const [a] =
        k.tipo === 'pedido'
          ? await tx.consultarParaAtualizar(
              `SELECT id, versao FROM pedido_vinculo_profissional_externo
                WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL AND conta_portal_profissional_externo_id IS NULL`,
              [k.id, est],
              { teto: 1 },
            )
          : k.tipo === 'protocolo'
            ? await tx.consultarParaAtualizar(
                'SELECT id, versao FROM protocolo_acesso_portal WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
                [k.id, est],
                { teto: 1 },
              )
            : await tx.consultarParaAtualizar(
                `SELECT cp.id, cp.versao FROM conta_portal_profissional_externo cp
                 JOIN pedido_vinculo_profissional_externo pv ON pv.conta_portal_profissional_externo_id = cp.id
                WHERE cp.id = ? AND pv.estabelecimento_id = ? AND cp.excluido_em IS NULL LIMIT 1`,
                [k.id, est],
                { teto: 1 },
              );
      if (!a) throw recusa('acesso-inexistente', 'O acesso ao portal não existe neste estabelecimento.');
      const tentativas = Math.max(0, Math.min(65_535, Math.trunc(r.tentativas)));
      if (k.tipo === 'protocolo')
        await tx.alterar('protocolo_acesso_portal', k.id, n(a['versao']), {
          tentativas_falhas: tentativas,
          bloqueado_ate: r.bloqueadoAte,
        });
      else if (k.tipo === 'pedido')
        await tx.alterar('pedido_vinculo_profissional_externo', k.id, n(a['versao']), {
          tentativas_falhas: tentativas,
          bloqueado_ate: r.bloqueadoAte,
        });
      else
        await tx.alterar('conta_portal_profissional_externo', k.id, n(a['versao']), {
          tentativas_falhas: tentativas,
          bloqueada_ate: r.bloqueadoAte,
          ...(r.acertou ? { ultimo_acesso_em: agora() } : {}),
        });
    },
  };
}

/** O nome da operação: o evento da tela (`dadosDepois.evento`) quando a trilha é fixa; senão, o genérico do módulo. */
export function nomeDaGravacao(modulo: string, trilha: unknown): string {
  const ev =
    typeof trilha === 'function'
      ? null
      : (trilha as { dadosDepois?: { evento?: unknown } } | null)?.dadosDepois?.evento;
  if (typeof ev !== 'string') return `${modulo}.gravacao`;
  const nome = ev.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return /^[a-z][a-z0-9_.-]{2,119}$/.test(nome) && nome.startsWith(`${modulo.split('.')[0]}.`)
    ? nome
    : `${modulo}.gravacao`;
}

/** O valor da gravação guardado no resultado da operação (a repetida pela chave devolve o mesmo valor). */
export function resultadoDe(v: unknown): ResultadoOperacao {
  return { valor: v === undefined ? null : JSON.stringify(v) };
}

export function valorDe<T>(r: ResultadoOperacao): T {
  const v = r['valor'];
  return (typeof v === 'string' ? JSON.parse(v) : undefined) as T;
}

function contextoDe(c: ContextoNucleo): ContextoNucleo {
  return {
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: (c.correlacao || 'sadt').slice(0, 64),
  };
}

/** Fora de dev/ci sem o núcleo: toda chamada responde 503 (nada lido nem gravado). */
export function portaSadtIndisponivel(): PortaSadt {
  return portaIndisponivel<PortaSadt>(METODOS_PORTA_SADT);
}
