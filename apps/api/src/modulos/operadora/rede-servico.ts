// Serviço da rede credenciada da operadora própria (M56, etapa 4, F3): monta as respostas da tela a partir das leituras
// da porta e decide no servidor o que a tela só mostra: os rótulos dos domínios (o do vocabulário quando o código é
// fixo; o do banco nos editáveis), o documento mascarado na lista (CPF do prestador pessoa física), as regras do
// credenciamento, da alteração, do descredenciamento e da reinclusão (@sgh/dominio-operadora) e o movimento do RPS.
// As gravações passam pelas recusas das regras antes de chegar ao banco; a versão vista e as chaves únicas são do banco.
import {
  type AlterarPrestadorEntrada,
  type ApoioRede,
  CLASSIFICACOES_REDE,
  CONTRATACOES_PRESTADOR,
  type CredenciarPrestadorEntrada,
  type DescredenciarPrestadorEntrada,
  DISPONIBILIDADES_SERVICO,
  FORMAS_REAJUSTE,
  ISENCOES_ONUS,
  MENSAGENS_REDE,
  MODELOS_REMUNERACAO,
  MOVIMENTOS_REDE,
  type MovimentoRps,
  type PrestadorDetalhe,
  type PrestadorResumo,
  REGIMES_ATENDIMENTO_OPERADORA,
  type ReincluirPrestadorEntrada,
  TIPOS_PRESTADOR_REDE,
} from '@sgh/contratos';
import {
  camposRpsMudados,
  conferirDescredenciamento,
  documentoExibido,
  type DominiosRede,
  normalizarDocumento,
  podeAlterar,
  podeReincluir,
  prestadorHospitalar,
  problemasDoPrestador,
  valoresRps,
} from '@sgh/dominio-operadora';
import { ErroProblema } from '../../problema.filter.js';
import type {
  ContextoRede,
  DominioRede,
  ItemDominioRede,
  MovimentoRede,
  PortaRedeOperadora,
  Prestador,
} from './rede-porta.js';

/** Rótulos do vocabulário dos domínios fixos (o banco tem alguns em maiúsculas e sem acento). */
const VOCABULARIO: Partial<Record<DominioRede, Readonly<Record<number, string>>>> = {
  tipo: TIPOS_PRESTADOR_REDE,
  classificacao: CLASSIFICACOES_REDE,
  contratacao: CONTRATACOES_PRESTADOR,
  disponibilidade: DISPONIBILIDADES_SERVICO,
  isencaoOnus: ISENCOES_ONUS,
  regime: REGIMES_ATENDIMENTO_OPERADORA,
  remuneracao: MODELOS_REMUNERACAO,
  formaReajuste: FORMAS_REAJUSTE,
  movimento: MOVIMENTOS_REDE,
};

/** Rótulo em maiúsculas vira frase (só a primeira letra maiúscula); o resto fica como o banco tem. */
function frase(t: string): string {
  const s = t.trim();
  return s && s === s.toUpperCase() && /[A-Z]/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

export function rotulosDosDominios(
  d: Record<DominioRede, ItemDominioRede[]>,
): Record<DominioRede, { codigo: number; rotulo: string }[]> {
  const r = {} as Record<DominioRede, { codigo: number; rotulo: string }[]>;
  for (const k of Object.keys(d) as DominioRede[])
    r[k] = d[k].map((x) => ({ codigo: x.codigo, rotulo: VOCABULARIO[k]?.[x.codigo] ?? frase(x.rotulo) }));
  return r;
}

const conjuntos = (d: Record<DominioRede, ItemDominioRede[]>): DominiosRede => {
  const s = (k: DominioRede) => new Set(d[k].map((x) => x.codigo));
  return {
    tipo: s('tipo'),
    natureza: s('natureza'),
    classificacao: s('classificacao'),
    contratacao: s('contratacao'),
    disponibilidade: s('disponibilidade'),
    isencaoOnus: s('isencaoOnus'),
    regime: s('regime'),
    remuneracao: s('remuneracao'),
    formaReajuste: s('formaReajuste'),
  };
};

/** Recusa das regras (nada é lido do banco depois nem gravado): 409 com o primeiro código, os campos e os textos. */
function recusaDasRegras(problemas: readonly { codigo: string; campo?: string }[]): ErroProblema {
  const [p] = problemas;
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    problemas.map((x) => MENSAGENS_REDE[x.codigo] ?? x.codigo).join(' '),
    {
      codigo: p?.codigo ?? 'recusa',
      campos: [...new Set(problemas.map((x) => x.campo).filter((c): c is string => !!c))],
      bloqueios: problemas.map((x) => x.codigo),
    },
  );
}

const naoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Prestador não encontrado',
    'O prestador não está na rede da operadora.',
  );

export function resumoDe(p: Prestador): PrestadorResumo {
  return {
    id: p.id,
    pessoa: p.pessoa,
    documento: documentoExibido(p.pessoa, p.documento, true),
    nome: p.nome,
    cnes: p.cnes,
    uf: p.uf,
    municipioIbge: p.municipioIbge,
    tipo: p.tipo,
    classificacao: p.classificacao,
    hospitalar: prestadorHospitalar(p),
    ehOHospital: p.ehOHospital,
    estabelecimento: p.estabelecimento,
    situacao: p.situacao,
    situacaoEm: p.situacaoEm,
    saidaEm: p.saidaEm,
    contratoFim: p.contrato.fim,
    versao: p.versao,
  };
}

const movimentoDe = (m: MovimentoRede): MovimentoRps => ({ ...m });

export interface EstabelecimentoDaRede {
  readonly codigo: string;
  readonly nome: string;
}

export class ServicoRedeOperadora {
  constructor(readonly porta: PortaRedeOperadora) {}

  async apoio(
    c: ContextoRede,
    x: {
      ligada: boolean;
      motivo: string | null;
      podeEditar: boolean;
      estabelecimentos: readonly EstabelecimentoDaRede[];
    },
  ): Promise<ApoioRede> {
    const [dominios, convenios, hoje] = await Promise.all([
      this.porta.dominios(c),
      this.porta.convenios(c),
      this.porta.hoje(c),
    ]);
    return {
      dominios: rotulosDosDominios(dominios),
      convenios: convenios.map((v) => ({ codigo: v.codigo, nome: v.nome, registroAns: v.registroAns })),
      estabelecimentos: x.estabelecimentos.map((e) => ({ codigo: e.codigo, nome: e.nome })),
      ligada: x.ligada,
      motivo: x.motivo,
      podeEditar: x.podeEditar && x.ligada,
      hoje,
    };
  }

  async detalhe(c: ContextoRede, id: number): Promise<PrestadorDetalhe> {
    const p = await this.porta.prestador(c, id);
    if (!p) throw naoEncontrado();
    const movs = await this.porta.movimentos(c, { prestador: id });
    return {
      ...p,
      documento: documentoExibido(p.pessoa, p.documento, false),
      hospitalar: prestadorHospitalar(p),
      movimentos: movs.itens.map(movimentoDe),
    };
  }

  private async conferirConvenio(c: ContextoRede, convenio: number | null): Promise<void> {
    if (convenio === null) return;
    const lista = await this.porta.convenios(c);
    if (!lista.some((v) => v.codigo === convenio))
      throw recusaDasRegras([{ codigo: 'convenio-inexistente', campo: 'convenio' }]);
  }

  /** As regras do credenciamento (a mesma conferência na alteração, com o documento e a pessoa gravados). */
  private async conferir(
    c: ContextoRede,
    dados: Parameters<typeof problemasDoPrestador>[0] & { convenio: number | null },
    estabelecimentos: readonly EstabelecimentoDaRede[],
  ): Promise<void> {
    const dominios = conjuntos(await this.porta.dominios(c));
    const problemas = problemasDoPrestador(dados, dominios, new Set(estabelecimentos.map((e) => e.codigo)));
    if (problemas.length) throw recusaDasRegras(problemas);
    await this.conferirConvenio(c, dados.convenio);
  }

  async conferirCredenciamento(
    c: ContextoRede,
    e: CredenciarPrestadorEntrada,
    estabelecimentos: readonly EstabelecimentoDaRede[],
  ): Promise<CredenciarPrestadorEntrada> {
    const x = { ...e, documento: normalizarDocumento(e.documento) };
    await this.conferir(c, x, estabelecimentos);
    return x;
  }

  async conferirAlteracao(
    c: ContextoRede,
    id: number,
    e: AlterarPrestadorEntrada,
    estabelecimentos: readonly EstabelecimentoDaRede[],
  ): Promise<{ atual: Prestador; camposRps: string[] }> {
    const atual = await this.porta.prestador(c, id);
    if (!atual) throw naoEncontrado();
    // O descredenciado e o de saída agendada já têm a exclusão no RPS: alterar depois dela é movimento incoerente.
    if (!podeAlterar(atual)) throw recusaDasRegras([{ codigo: 'so-credenciado', campo: 'situacao' }]);
    await this.conferir(c, { ...e, pessoa: atual.pessoa, documento: atual.documento }, estabelecimentos);
    return { atual, camposRps: camposRpsMudados(valoresRps(atual), valoresRps(e)) };
  }

  async conferirDescredenciamento(
    c: ContextoRede,
    id: number,
    e: DescredenciarPrestadorEntrada,
  ): Promise<{ atual: Prestador; avisos: string[] }> {
    const atual = await this.porta.prestador(c, id);
    if (!atual) throw naoEncontrado();
    const substituto =
      e.substituto !== null && e.substituto !== id ? await this.porta.prestador(c, e.substituto) : null;
    const hoje = await this.porta.hoje(c);
    const r = conferirDescredenciamento(atual, e, substituto, hoje);
    if (r.problemas.length)
      throw recusaDasRegras(
        r.problemas.map((codigo) => ({
          codigo,
          campo: codigo.startsWith('substituto')
            ? 'substituto'
            : codigo === 'ja-descredenciado' || codigo === 'saida-ja-agendada'
              ? 'situacao'
              : codigo === 'aviso-no-futuro'
                ? 'avisoBeneficiariosEm'
                : 'efetivoEm',
        })),
      );
    return { atual, avisos: r.avisos.map((a) => MENSAGENS_REDE[a] ?? a) };
  }

  async conferirReinclusao(c: ContextoRede, id: number, e: ReincluirPrestadorEntrada): Promise<Prestador> {
    const atual = await this.porta.prestador(c, id);
    if (!atual) throw naoEncontrado();
    const problemas: { codigo: string; campo: string }[] = [];
    if (!podeReincluir(atual)) problemas.push({ codigo: 'so-descredenciado', campo: 'situacao' });
    if (e.contrato.fim !== null && e.contrato.fim < e.contrato.inicio)
      problemas.push({ codigo: 'contrato-fim-antes-do-inicio', campo: 'contrato.fim' });
    const formas = new Set((await this.porta.dominios(c)).formaReajuste.map((x) => x.codigo));
    if (!formas.has(e.contrato.formaReajuste))
      problemas.push({ codigo: 'dominio-invalido', campo: 'contrato.formaReajuste' });
    if (problemas.length) throw recusaDasRegras(problemas);
    return atual;
  }
}
