// Arquivo da CIHA para importação no CIHA01 (o estabelecimento importa a remessa no CIHA01 e a entrega ao gestor, que
// consolida no CIHA02). Descritor conferido campo a campo contra o documento oficial "Especificações para geração de
// arquivo de texto para importação no CIHA01", versão 1.0.4.0 (LayOutCIHA01V1.0.4.0.zip, publicado em
// ciha.datasus.gov.br › Documentação; baixado em 2026-10-25 pelo construtor do M51.1):
//   - linha de header: TIPO_REG (1) = 1, CNES (7), VERSAO (7) = 1.0.4.0;
//   - registro de dados, 390 posições, com TIPO_REG 2 (individualizado hospitalar), 3 (sem movimento: só o TIPO_REG),
//     4 (individualizado ambulatorial) ou 5 (consolidado: procedimento, fonte, registro ANS, competência e quantidade);
//   - datas DDMMAAAA e competência MMAAAA; um procedimento por linha (PROC_REA), com a quantidade.
// Os códigos das fontes de remuneração (TP_FREMU, "anexo I") ficam na tabela do próprio CIHA01; o leiaute confirma 1
// (plano privado: registro ANS, beneficiário e guia TISS) e 6 e 9 (CNPJ obrigatório), e os demais seguem a ordem da
// Portaria GM/MS 1.171/2011 (decisão D-FONTE-51 nas evidências: o faturamento confere na importação de teste).
import type { CompetenciaSus, FonteRemuneracaoCiha } from '@sgh/contratos';
import type { RegistroCiha } from './ciha.js';
import { type CampoLeiaute, FIM_DE_LINHA, type Leiaute, montarLinha } from './leiaute.js';

/** Versão do CIHA01 que o header declara (campo VERSAO). */
export const VERSAO_CIHA01 = '1.0.4.0';

const n = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'N',
  obrigatorio,
  branco: true,
});
const a = (nome: string, tamanho: number, obrigatorio = false): CampoLeiaute => ({
  nome,
  tamanho,
  tipo: 'A',
  obrigatorio,
});

/** Campos do registro de dados (posições 1 a 390), com os obrigatórios do tipo. */
function dados(tipo: '2' | '4' | '5'): CampoLeiaute[] {
  const ind = tipo !== '5';
  const hosp = tipo === '2';
  return [
    { nome: 'tipo', tamanho: 1, tipo: 'N', obrigatorio: true, fixo: tipo },
    a('nome', 60, ind),
    a('logradouro', 25, ind),
    a('numero', 5),
    a('complemento', 15),
    n('municipio', 6, ind),
    a('uf', 2, ind),
    n('cep', 8, ind),
    n('nascimento', 8, ind),
    a('sexo', 1, ind),
    n('cns', 15),
    n('procedimento', 10, true),
    a('cidPrincipal', 4, ind),
    a('cidSecundario', 4),
    n('atendimento', 8, ind),
    n('alta', 8, hosp),
    n('motivoAlta', 2, hosp),
    n('fonte', 2, true),
    a('descricaoProcedimento', 40),
    n('regAns', 6),
    n('cnpj', 14),
    a('beneficiario', 30),
    n('obito', 11),
    n('nascidos', 1),
    n('dn1', 11),
    n('dn2', 11),
    n('dn3', 11),
    n('dn4', 11),
    n('dn5', 11),
    n('diasUti', 3),
    a('prontuario', 12, ind),
    n('competencia', 6, true),
    n('quantidade', 6, true),
    n('modalidade', 2, ind),
    a('guiaTiss', 20),
  ];
}

export const LEIAUTE_CIHA01: Leiaute = {
  nome: 'CIHA01',
  versao: VERSAO_CIHA01,
  conferidoContraOficial: true,
  fonte:
    'Especificações para geração de arquivo de texto para importação no CIHA01, V 1.0.4.0 (DATASUS); Orientações Técnicas CIHA v4 (21/07/2011)',
  registros: {
    '1': {
      tipo: '1',
      campos: [
        { nome: 'tipo', tamanho: 1, tipo: 'N', obrigatorio: true, fixo: '1' },
        { nome: 'cnes', tamanho: 7, tipo: 'N', obrigatorio: true },
        { nome: 'versao', tamanho: 7, tipo: 'A', obrigatorio: true, fixo: VERSAO_CIHA01 },
      ],
    },
    '2': { tipo: '2', campos: dados('2') },
    '3': {
      tipo: '3',
      campos: [{ nome: 'tipo', tamanho: 1, tipo: 'N', obrigatorio: true, fixo: '3' }, a('vazio', 389)],
    },
    '4': { tipo: '4', campos: dados('4') },
    '5': { tipo: '5', campos: dados('5') },
  },
};

/** Código da fonte de remuneração no arquivo (TP_FREMU; veja o cabeçalho deste módulo). */
export const CODIGO_FONTE_CIHA: Readonly<Record<FonteRemuneracaoCiha, number>> = {
  'plano-privado': 1,
  'plano-publico': 2,
  'particular-pf': 3,
  'particular-pj': 4,
  'programa-federal': 5,
  'recurso-proprio-gestor': 6,
  dpvat: 7,
  gratuidade: 8,
  'consorcio-publico': 9,
};

/** AAAA-MM-DD → DDMMAAAA. */
const ddmmaaaa = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
/** AAAAMM → MMAAAA. */
const mmaaaa = (c: CompetenciaSus) => `${c.slice(4, 6)}${c.slice(0, 4)}`;
/** O texto cortado no tamanho do campo (nome de 70 caracteres no cadastro, 60 no leiaute). */
const corte = (v: string | null, t: number) => (v === null ? null : v.trim().slice(0, t));

export interface ArquivoCihaGerado {
  readonly nomeArquivo: string;
  readonly conteudo: string;
  readonly linhas: number;
  /** Atendimentos (internações e atendimentos ambulatoriais) no arquivo. */
  readonly registros: number;
  /** Linhas de procedimento (individualizadas e consolidadas). */
  readonly procedimentos: number;
  readonly semMovimento: boolean;
  readonly leiaute: string;
  readonly versaoLeiaute: string;
  readonly conferidoContraOficial: boolean;
}

/**
 * Monta o arquivo: o header, uma linha individualizada por procedimento de cada atendimento (2 na internação, 4 na
 * ambulatorial) e, no fim, as consolidadas (5) somadas por procedimento, fonte e registro ANS. Sem registro, sai a
 * remessa "sem movimento" (o header e uma linha com o TIPO_REG 3), como o leiaute pede. A ordem é a da lista recebida
 * (o adaptador ordena por conta): o mesmo conjunto dá o mesmo arquivo e o mesmo hash.
 */
export function gerarArquivoCiha(
  competencia: CompetenciaSus,
  cnes: string | number,
  registros: readonly RegistroCiha[],
  l: Leiaute = LEIAUTE_CIHA01,
  codigoFonte: Readonly<Record<FonteRemuneracaoCiha, number>> = CODIGO_FONTE_CIHA,
): ArquivoCihaGerado {
  const linhas: string[] = [montarLinha(l, '1', { cnes })];
  const consolidadas = new Map<
    string,
    { procedimento: string; fonte: number; regAns: number | null; q: number }
  >();
  let individuais = 0;
  for (const r of registros) {
    const tipo = r.modalidade === 'internacao' ? '2' : '4';
    for (const p of r.procedimentos) {
      const fonte = codigoFonte[r.fonte];
      if (p.consolidado) {
        const k = `${p.codigo}|${fonte}|${r.regAns ?? ''}`;
        const atual = consolidadas.get(k);
        consolidadas.set(k, {
          procedimento: p.codigo,
          fonte,
          regAns: r.regAns,
          q: (atual?.q ?? 0) + Math.round(p.quantidade),
        });
        continue;
      }
      individuais += 1;
      linhas.push(
        montarLinha(l, tipo, {
          nome: corte(r.nome, 60),
          logradouro: corte(r.logradouro, 25),
          numero: corte(r.numero, 5),
          complemento: corte(r.complemento, 15),
          municipio: r.municipio === null ? null : String(r.municipio).slice(0, 6),
          uf: r.uf,
          cep: r.cep.slice(0, 8),
          nascimento: ddmmaaaa(r.nascimento),
          sexo: r.sexo,
          cns: r.cns,
          procedimento: p.codigo,
          cidPrincipal: r.cidPrincipal.slice(0, 4),
          cidSecundario: r.cidSecundario?.slice(0, 4) ?? null,
          atendimento: ddmmaaaa(r.entrada),
          alta: tipo === '2' ? ddmmaaaa(r.saida) : null,
          motivoAlta: tipo === '2' ? r.motivoAlta : null,
          fonte,
          regAns: r.regAns,
          cnpj: r.cnpjOperadora,
          beneficiario: corte(r.beneficiario, 30),
          obito: tipo === '2' ? r.declaracaoObito : null,
          prontuario: String(r.prontuario).slice(0, 12),
          competencia: mmaaaa(competencia),
          quantidade: Math.max(1, Math.round(p.quantidade)),
          modalidade: r.modalidade === 'internacao' ? '02' : '01',
          guiaTiss: corte(r.guiaTiss, 20),
        }),
      );
    }
  }
  const somadas = [...consolidadas.values()].sort(
    (x, y) => x.procedimento.localeCompare(y.procedimento) || x.fonte - y.fonte,
  );
  for (const c of somadas)
    linhas.push(
      montarLinha(l, '5', {
        procedimento: c.procedimento,
        fonte: c.fonte,
        regAns: c.regAns,
        competencia: mmaaaa(competencia),
        quantidade: c.q,
      }),
    );
  if (registros.length === 0) linhas.push(montarLinha(l, '3', {}));
  return {
    nomeArquivo: `CIHA_${String(cnes).padStart(7, '0')}_${competencia}.TXT`,
    conteudo: linhas.join(FIM_DE_LINHA) + FIM_DE_LINHA,
    linhas: linhas.length,
    registros: registros.length,
    procedimentos: individuais + somadas.length,
    semMovimento: registros.length === 0,
    leiaute: l.nome,
    versaoLeiaute: l.versao,
    conferidoContraOficial: l.conferidoContraOficial,
  };
}
