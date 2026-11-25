// RAAS: registro das ações ambulatoriais de saúde da atenção psicossocial (CAPS, instrumento 09 da tabela unificada) e
// da atenção domiciliar (instrumento 08), por paciente e competência (06-SUS linha 64). Regras puras: o que pode ser
// lançado (cabeçalho e ação), a crítica da competência, a continuação do acompanhamento na competência seguinte e o
// arquivo de largura fixa da remessa. Desenho próprio: um registro por paciente, tipo e competência (a ação lançada ao
// longo do mês entra no mesmo registro), validação na hora da ação e a crítica com código estável, gravidade e campo.
// Descritor do arquivo pelo leiaute de exportação conhecido do construtor: `conferidoContraOficial: false` até o
// faturamento conferir campo a campo na importação de teste (a tela avisa para não enviar enquanto não conferido).
import type { CompetenciaSus } from '@sgh/contratos';
import { controleBpa } from './bpa-leiaute.js';
import { competenciaSeguinte, dataNaCompetencia, intervaloDaCompetencia } from './competencia.js';
import type { RegistroSigtap } from './instrumento.js';
import { type CampoLeiaute, FIM_DE_LINHA, type Leiaute, montarLinha } from './leiaute.js';

export const TIPOS_RAAS = ['atencao_psicossocial', 'atencao_domiciliar'] as const;
export type TipoRaas = (typeof TIPOS_RAAS)[number];

/** O instrumento de registro da tabela unificada que cada tipo de RAAS aceita. */
export const REGISTRO_DO_TIPO_RAAS: Readonly<Record<TipoRaas, RegistroSigtap>> = {
  atencao_psicossocial: 'raas-psicossocial',
  atencao_domiciliar: 'raas-domiciliar',
};

export const LOCAIS_RAAS = ['unidade', 'territorio', 'domicilio'] as const;
export type LocalRaas = (typeof LOCAIS_RAAS)[number];

export interface ProblemaRaas {
  readonly campo: string;
  readonly mensagem: string;
}

/** O tipo de RAAS que o procedimento admite pelos seus instrumentos de registro (null: nenhum). */
export function tiposRaasDoProcedimento(registros: readonly RegistroSigtap[]): TipoRaas[] {
  return TIPOS_RAAS.filter((t) => registros.includes(REGISTRO_DO_TIPO_RAAS[t]));
}

export interface CabecalhoRaas {
  readonly tipo: TipoRaas;
  readonly competencia: CompetenciaSus;
  readonly dataAdmissao: string;
  readonly dataConclusao: string | null;
  readonly destino: number | null;
  readonly estrategiaSaudeFamilia: boolean;
  readonly cnesSaudeFamilia: string | null;
}

/** O cabeçalho do registro: admissão até o fim da competência, conclusão dentro dela e com destino, CNES da ESF. */
export function conferirCabecalhoRaas(r: CabecalhoRaas): ProblemaRaas[] {
  const p: ProblemaRaas[] = [];
  const { inicio, fim } = intervaloDaCompetencia(r.competencia);
  if (r.dataAdmissao > fim)
    p.push({ campo: 'dataAdmissao', mensagem: 'A admissão não pode ser posterior ao fim da competência.' });
  if (r.dataConclusao !== null) {
    if (r.dataConclusao < r.dataAdmissao)
      p.push({ campo: 'dataConclusao', mensagem: 'A conclusão não pode ser anterior à admissão.' });
    else if (r.dataConclusao < inicio || r.dataConclusao > fim)
      p.push({
        campo: 'dataConclusao',
        mensagem: 'A conclusão tem de estar dentro da competência do registro.',
      });
    if (r.destino === null)
      p.push({ campo: 'destino', mensagem: 'Informe o destino do paciente na conclusão.' });
  }
  if (r.estrategiaSaudeFamilia && !/^\d{7}$/.test(r.cnesSaudeFamilia ?? ''))
    p.push({
      campo: 'cnesSaudeFamilia',
      mensagem:
        'Paciente coberto pela saúde da família: informe o CNES (7 dígitos) da unidade de referência.',
    });
  if (!r.estrategiaSaudeFamilia && r.cnesSaudeFamilia)
    p.push({
      campo: 'cnesSaudeFamilia',
      mensagem: 'O CNES da saúde da família só vale com a cobertura marcada.',
    });
  return p;
}

export interface AcaoRaas {
  readonly sequencia: number;
  readonly procedimento: string;
  readonly registros: readonly RegistroSigtap[];
  readonly cbo: string | null;
  readonly cnsProfissional: string | null;
  readonly dataInicio: string;
  readonly dataFim: string | null;
  readonly quantidade: number;
  readonly local: LocalRaas;
  readonly cid: string | null;
}

/** A ação lançada no registro: instrumento do tipo, quantidade inteira, datas na competência e depois da admissão. */
export function conferirAcaoRaas(
  tipo: TipoRaas,
  competencia: CompetenciaSus,
  dataAdmissao: string,
  a: Omit<AcaoRaas, 'sequencia'>,
): ProblemaRaas[] {
  const p: ProblemaRaas[] = [];
  if (!a.registros.includes(REGISTRO_DO_TIPO_RAAS[tipo]))
    p.push({
      campo: 'procedimento',
      mensagem: `O procedimento ${a.procedimento} não é registrado na RAAS de ${rotuloTipoRaas(tipo)}.`,
    });
  if (!Number.isInteger(a.quantidade) || a.quantidade <= 0)
    p.push({ campo: 'quantidade', mensagem: 'A quantidade é um inteiro maior que zero.' });
  if (!a.cbo) p.push({ campo: 'cbo', mensagem: 'Informe a ocupação (CBO) de quem realizou a ação.' });
  if (!dataNaCompetencia(a.dataInicio, competencia))
    p.push({ campo: 'dataInicio', mensagem: 'A data da ação tem de estar dentro da competência.' });
  else if (a.dataInicio < dataAdmissao)
    p.push({ campo: 'dataInicio', mensagem: 'A ação não pode ser anterior à admissão do paciente.' });
  if (a.dataFim !== null) {
    if (a.dataFim < a.dataInicio)
      p.push({ campo: 'dataFim', mensagem: 'O fim da ação não pode ser anterior ao início.' });
    else if (!dataNaCompetencia(a.dataFim, competencia))
      p.push({ campo: 'dataFim', mensagem: 'O fim da ação tem de estar dentro da competência.' });
  }
  return p;
}

export function rotuloTipoRaas(t: TipoRaas): string {
  return t === 'atencao_psicossocial' ? 'atenção psicossocial' : 'atenção domiciliar';
}

export interface RegistroRaasParaCritica extends CabecalhoRaas {
  readonly id: number;
  readonly cidPrincipal: string | null;
  readonly cnsPaciente: string | null;
  readonly cpfPaciente: string | null;
  readonly acoes: readonly AcaoRaas[];
}

export type GravidadeCriticaRaas = 'bloqueante' | 'aviso';

export interface CriticaRaas {
  readonly registro: number;
  /** Código estável da regra (vai em `codigo_regra`; a chave da crítica é regra + registro + sequência). */
  readonly regra: string;
  readonly gravidade: GravidadeCriticaRaas;
  readonly campo: string;
  readonly sequencia: number | null;
  readonly mensagem: string;
}

export const REGRAS_CRITICA_RAAS = {
  semCid: 'raas.cid-principal',
  semIdentificacao: 'raas.identificacao-paciente',
  semAcao: 'raas.sem-acao',
  cabecalho: 'raas.cabecalho',
  acao: 'raas.acao',
  profissionalSemCns: 'raas.cns-profissional',
  acaoRepetida: 'raas.acao-repetida',
  domiciliarForaDoDomicilio: 'raas.domiciliar-fora-do-domicilio',
} as const;

const cnsValido = (v: string | null) => /^[1-9]\d{14}$/.test(v ?? '');
const cpfValido = (v: string | null) => /^\d{11}$/.test(v ?? '');

/**
 * A crítica do registro na competência: bloqueia o que impede a remessa (CID, identificação do paciente, ação, cabeçalho,
 * ação inválida e profissional sem CNS) e avisa o que o gestor costuma glosar (ação repetida no mesmo dia pelo mesmo
 * profissional; atenção domiciliar lançada fora do domicílio).
 */
export function criticarRegistroRaas(r: RegistroRaasParaCritica): CriticaRaas[] {
  const out: CriticaRaas[] = [];
  const add = (
    regra: string,
    gravidade: GravidadeCriticaRaas,
    campo: string,
    mensagem: string,
    sequencia: number | null = null,
  ) => out.push({ registro: r.id, regra, gravidade, campo, sequencia, mensagem });
  if (!r.cidPrincipal)
    add(REGRAS_CRITICA_RAAS.semCid, 'bloqueante', 'cidPrincipal', 'Registro sem CID principal.');
  if (!cnsValido(r.cnsPaciente) && !cpfValido(r.cpfPaciente))
    add(
      REGRAS_CRITICA_RAAS.semIdentificacao,
      'bloqueante',
      'paciente',
      'Paciente sem CNS nem CPF válido: complete o cadastro.',
    );
  if (r.acoes.length === 0)
    add(REGRAS_CRITICA_RAAS.semAcao, 'bloqueante', 'acoes', 'Registro sem nenhuma ação na competência.');
  for (const p of conferirCabecalhoRaas(r))
    add(REGRAS_CRITICA_RAAS.cabecalho, 'bloqueante', p.campo, p.mensagem);
  const vistos = new Set<string>();
  for (const a of r.acoes) {
    for (const p of conferirAcaoRaas(r.tipo, r.competencia, r.dataAdmissao, a))
      add(REGRAS_CRITICA_RAAS.acao, 'bloqueante', p.campo, `Ação ${a.sequencia}: ${p.mensagem}`, a.sequencia);
    if (!cnsValido(a.cnsProfissional))
      add(
        REGRAS_CRITICA_RAAS.profissionalSemCns,
        'bloqueante',
        'profissional',
        `Ação ${a.sequencia}: profissional sem CNS válido.`,
        a.sequencia,
      );
    const chave = `${a.procedimento}|${a.dataInicio}|${a.cnsProfissional ?? ''}`;
    if (vistos.has(chave))
      add(
        REGRAS_CRITICA_RAAS.acaoRepetida,
        'aviso',
        'procedimento',
        `Ação ${a.sequencia}: mesmo procedimento, dia e profissional de outra ação do registro.`,
        a.sequencia,
      );
    vistos.add(chave);
    if (r.tipo === 'atencao_domiciliar' && a.local !== 'domicilio')
      add(
        REGRAS_CRITICA_RAAS.domiciliarForaDoDomicilio,
        'aviso',
        'local',
        `Ação ${a.sequencia}: atenção domiciliar lançada fora do domicílio.`,
        a.sequencia,
      );
  }
  return out;
}

/** A chave estável da crítica na competência (regra, registro e ação). */
export function chaveCriticaRaas(c: CriticaRaas): string {
  return `${c.regra}:${c.registro}:${c.sequencia ?? 0}:${c.campo}`.slice(0, 120);
}

/**
 * O acompanhamento que não foi concluído continua na competência seguinte: um registro novo com a mesma admissão,
 * ligado ao anterior. Concluído, cancelado ou rejeitado não continua.
 */
export function continuacaoRaas(r: {
  readonly competencia: CompetenciaSus;
  readonly dataConclusao: string | null;
  readonly situacao: string;
}): { competencia: CompetenciaSus } | ProblemaRaas {
  if (r.dataConclusao !== null)
    return { campo: 'dataConclusao', mensagem: 'O acompanhamento foi concluído: não há continuação.' };
  if (r.situacao === 'cancelado' || r.situacao === 'rejeitado')
    return { campo: 'situacao', mensagem: 'Registro cancelado ou rejeitado não continua.' };
  return { competencia: competenciaSeguinte(r.competencia) };
}

/** A remessa só sai sem crítica bloqueante aberta e com ao menos um registro. */
export function recusaGerarRemessaRaas(registros: number, bloqueantes: number): ProblemaRaas | null {
  if (registros === 0)
    return { campo: 'registros', mensagem: 'Não há registro aberto ou fechado nesta competência e tipo.' };
  if (bloqueantes > 0)
    return {
      campo: 'criticas',
      mensagem: `Há ${bloqueantes} crítica(s) bloqueante(s) aberta(s): corrija e rode a crítica de novo.`,
    };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Arquivo da remessa (largura fixa, CR LF): cabeçalho 01, registro 02 (paciente e acompanhamento) e ação 03.

export const VERSAO_RAAS = '01.00';

const n = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio,
});
const nb = (nome: string, tamanho: number): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio: false,
  branco: true,
});
const a = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'A',
  obrigatorio,
});
const fixo = (nome: string, valor: string, tipo: 'N' | 'A' = 'N'): CampoLeiaute => ({
  nome,
  tamanho: valor.length,
  tipo,
  obrigatorio: true,
  fixo: valor,
});

export const LEIAUTE_RAAS: Leiaute = {
  nome: 'RAAS',
  versao: VERSAO_RAAS,
  conferidoContraOficial: false,
  fonte:
    'Leiaute de exportação do RAAS (SIA/SUS), descrito pelo construtor da C2-124; conferir com o documento vigente do DATASUS',
  registros: {
    '01': {
      tipo: '01',
      campos: [
        fixo('ident', '01'),
        fixo('marca', '#RAAS', 'A'),
        n('competencia', 6, true),
        n('tipo', 1, true),
        n('registros', 6, true),
        n('controle', 4, true),
        n('cnes', 7, true),
        nb('cnpj', 14),
        a('orgaoOrigem', 30, true),
        a('orgaoDestino', 40, true),
        a('indicadorDestino', 1, true),
        a('versao', 10, true),
      ],
    },
    '02': {
      tipo: '02',
      campos: [
        fixo('ident', '02'),
        n('competencia', 6, true),
        a('numero', 20, true),
        n('tipo', 1, true),
        nb('cnsPaciente', 15),
        nb('cpfPaciente', 11),
        a('nomePaciente', 60, true),
        nb('nascimento', 8),
        a('nomeMae', 60),
        n('admissao', 8, true),
        nb('conclusao', 8),
        a('destino', 2),
        a('origem', 2),
        a('cidPrincipal', 4, true),
        a('cidSecundario1', 4),
        a('cidSecundario2', 4),
        a('cidSecundario3', 4),
        a('cidAssociado', 4),
        n('saudeFamilia', 1, true),
        nb('cnesSaudeFamilia', 7),
        a('continuacao', 20),
      ],
    },
    '03': {
      tipo: '03',
      campos: [
        fixo('ident', '03'),
        n('competencia', 6, true),
        a('numero', 20, true),
        n('sequencia', 3, true),
        n('procedimento', 10, true),
        a('cbo', 6, true),
        n('cnsProfissional', 15, true),
        n('inicio', 8, true),
        nb('fim', 8),
        n('quantidade', 6, true),
        n('local', 1, true),
        a('cid', 4),
      ],
    },
  },
};

export interface AcaoNoArquivoRaas {
  readonly sequencia: number;
  readonly procedimento: string;
  readonly cbo: string;
  readonly cnsProfissional: string;
  readonly dataInicio: string;
  readonly dataFim: string | null;
  readonly quantidade: number;
  readonly local: LocalRaas;
  readonly cid: string | null;
}

export interface RegistroNoArquivoRaas {
  readonly numero: string;
  readonly cnsPaciente: string | null;
  readonly cpfPaciente: string | null;
  readonly nomePaciente: string;
  readonly nascimento: string | null;
  readonly nomeMae: string | null;
  readonly dataAdmissao: string;
  readonly dataConclusao: string | null;
  readonly destino: string | null;
  readonly origem: string | null;
  readonly cids: readonly (string | null)[];
  readonly cidAssociado: string | null;
  readonly estrategiaSaudeFamilia: boolean;
  readonly cnesSaudeFamilia: string | null;
  readonly continuacao: string | null;
  readonly acoes: readonly AcaoNoArquivoRaas[];
}

export interface CabecalhoArquivoRaas {
  readonly competencia: CompetenciaSus;
  readonly tipo: TipoRaas;
  readonly cnes: string;
  readonly cnpj: string | null;
  readonly orgaoOrigem: string;
  readonly orgaoDestino: string;
  readonly indicadorDestino: 'M' | 'E';
}

const semPonto = (v: string | null) => (v ? v.replace(/\./g, '') : null);
const dataAaaammdd = (v: string | null) => (v ? v.replace(/-/g, '') : null);
const codigoTipo = (t: TipoRaas) => (t === 'atencao_psicossocial' ? '1' : '2');
const codigoLocal = (l: LocalRaas) => ({ unidade: '1', territorio: '2', domicilio: '3' })[l];

/** O arquivo da remessa: cabeçalho com o campo de controle, cada registro e as suas ações. */
export function gerarArquivoRaas(
  cab: CabecalhoArquivoRaas,
  registros: readonly RegistroNoArquivoRaas[],
): { conteudo: string; linhas: number; procedimentos: number; controle: number } {
  const acoes = registros.flatMap((r) => r.acoes);
  const controle = controleBpa(
    acoes.map((x) => ({ procedimento: x.procedimento, quantidade: x.quantidade })),
  );
  const linhas: string[] = [
    montarLinha(LEIAUTE_RAAS, '01', {
      competencia: cab.competencia,
      tipo: codigoTipo(cab.tipo),
      registros: registros.length,
      controle,
      cnes: cab.cnes,
      cnpj: cab.cnpj,
      orgaoOrigem: cab.orgaoOrigem,
      orgaoDestino: cab.orgaoDestino,
      indicadorDestino: cab.indicadorDestino,
      versao: VERSAO_RAAS,
    }),
  ];
  for (const r of registros) {
    linhas.push(
      montarLinha(LEIAUTE_RAAS, '02', {
        competencia: cab.competencia,
        numero: r.numero,
        tipo: codigoTipo(cab.tipo),
        cnsPaciente: r.cnsPaciente,
        cpfPaciente: r.cpfPaciente,
        nomePaciente: r.nomePaciente,
        nascimento: dataAaaammdd(r.nascimento),
        nomeMae: r.nomeMae,
        admissao: dataAaaammdd(r.dataAdmissao),
        conclusao: dataAaaammdd(r.dataConclusao),
        destino: r.destino,
        origem: r.origem,
        cidPrincipal: semPonto(r.cids[0] ?? null),
        cidSecundario1: semPonto(r.cids[1] ?? null),
        cidSecundario2: semPonto(r.cids[2] ?? null),
        cidSecundario3: semPonto(r.cids[3] ?? null),
        cidAssociado: semPonto(r.cidAssociado),
        saudeFamilia: r.estrategiaSaudeFamilia ? '1' : '0',
        cnesSaudeFamilia: r.cnesSaudeFamilia,
        continuacao: r.continuacao,
      }),
    );
    for (const x of r.acoes)
      linhas.push(
        montarLinha(LEIAUTE_RAAS, '03', {
          competencia: cab.competencia,
          numero: r.numero,
          sequencia: x.sequencia,
          procedimento: x.procedimento,
          cbo: x.cbo,
          cnsProfissional: x.cnsProfissional,
          inicio: dataAaaammdd(x.dataInicio),
          fim: dataAaaammdd(x.dataFim),
          quantidade: x.quantidade,
          local: codigoLocal(x.local),
          cid: semPonto(x.cid),
        }),
      );
  }
  return {
    conteudo: linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA,
    linhas: linhas.length,
    procedimentos: acoes.reduce((s, x) => s + x.quantidade, 0),
    controle,
  };
}
