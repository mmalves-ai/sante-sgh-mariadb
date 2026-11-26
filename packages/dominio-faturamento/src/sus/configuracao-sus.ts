// Configuração do faturamento SUS (06-SUS linha 53, C1-051): regras puras da permissão por usuário e setor e dos
// parâmetros próprios de cada instrumento.
// Permissão por setor (prática de mercado): o cargo diz O QUE o usuário faz no faturamento SUS; a permissão do setor diz
// DE QUAIS SETORES ele digita ou fatura a produção. Quem não tem nenhuma permissão de setor vigente segue só pelo cargo
// (o hospital que não restringe não precisa cadastrar nada); quem tem passa a valer só nos setores listados. O
// administrador da plataforma (conta sem id no banco do cliente) passa sempre (ADR 0002).
import {
  type CamposParametroSus,
  cnpjValido,
  cnsValido,
  type InstrumentoParametroSus,
  type TipoPermissaoSetorSus,
  UFS,
} from '@sgh/contratos';

export interface PermissaoSetorSusVigencia {
  readonly setor: number;
  readonly tipo: TipoPermissaoSetorSus;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

export type AcaoSetorSus = 'digitacao' | 'faturamento';

export type RecusaSetorSus = 'sus-setor-sem-permissao' | 'sus-setor-nao-informado';

/** Se a permissão vale no dia (AAAA-MM-DD; o fim é inclusive). */
export function permissaoSetorVigente(p: PermissaoSetorSusVigencia, hoje: string): boolean {
  return p.vigenciaInicio <= hoje && (p.vigenciaFim === null || p.vigenciaFim >= hoje);
}

/** Se o tipo da permissão cobre a ação pedida. */
export function tipoCobre(tipo: TipoPermissaoSetorSus, acao: AcaoSetorSus): boolean {
  return tipo === 'digitacao_faturamento' || tipo === acao;
}

/**
 * Se o usuário pode digitar ou faturar a produção do setor. `usuario` null é o administrador da plataforma (passa
 * sempre). `permissoes` são as do usuário no estabelecimento (todas, vigentes ou não). Sem nenhuma vigente: vale o cargo.
 */
export function decidirSetorSus(
  permissoes: readonly PermissaoSetorSusVigencia[],
  pedido: {
    readonly usuario: number | null;
    readonly setor: number | null;
    readonly acao: AcaoSetorSus;
    readonly hoje: string;
  },
): RecusaSetorSus | null {
  if (pedido.usuario === null) return null;
  const vigentes = permissoes.filter((p) => permissaoSetorVigente(p, pedido.hoje));
  if (vigentes.length === 0) return null;
  if (pedido.setor === null) return 'sus-setor-nao-informado';
  return vigentes.some((p) => p.setor === pedido.setor && tipoCobre(p.tipo, pedido.acao))
    ? null
    : 'sus-setor-sem-permissao';
}

/**
 * Os setores em que o usuário pode a ação (o filtro das listagens por atendimento). null: sem restrição (o administrador
 * da plataforma, ou nenhuma permissão vigente, quando vale só o cargo). Lista vazia: nenhum setor (nada a listar).
 */
export function setoresPermitidosSus(
  permissoes: readonly PermissaoSetorSusVigencia[],
  pedido: { readonly usuario: number | null; readonly acao: AcaoSetorSus; readonly hoje: string },
): readonly number[] | null {
  if (pedido.usuario === null) return null;
  const vigentes = permissoes.filter((p) => permissaoSetorVigente(p, pedido.hoje));
  if (vigentes.length === 0) return null;
  return [...new Set(vigentes.filter((p) => tipoCobre(p.tipo, pedido.acao)).map((p) => p.setor))].sort(
    (a, b) => a - b,
  );
}

/**
 * As operações da competência inteira (criticar, fechar, gerar e baixar o arquivo, ver as linhas dele) levam a produção
 * de todos os setores: com restrição por setor, o usuário precisa da ação em cada setor com produção na competência (o
 * setor não informado também recusa). Sem restrição (administrador ou só o cargo), passa.
 */
export function decidirSetoresProducaoSus(
  permissoes: readonly PermissaoSetorSusVigencia[],
  pedido: {
    readonly usuario: number | null;
    readonly setores: readonly (number | null)[];
    readonly acao: AcaoSetorSus;
    readonly hoje: string;
  },
): RecusaSetorSus | null {
  const permitidos = setoresPermitidosSus(permissoes, pedido);
  if (permitidos === null) return null;
  if (pedido.setores.some((s) => s === null)) return 'sus-setor-nao-informado';
  return pedido.setores.every((s) => s !== null && permitidos.includes(s)) ? null : 'sus-setor-sem-permissao';
}

export type RecusaPermissaoSetorSus = 'sus-permissao-vigencia-invalida' | 'sus-permissao-sobreposta';

/**
 * A inclusão: o fim não antes do início; a mesma pessoa no mesmo setor não pode ter duas permissões com períodos que se
 * cruzam (a troca do tipo é encerrar a atual e incluir a nova).
 */
export function recusaIncluirPermissaoSetorSus(
  nova: PermissaoSetorSusVigencia,
  existentesDoUsuario: readonly PermissaoSetorSusVigencia[],
): RecusaPermissaoSetorSus | null {
  if (nova.vigenciaFim !== null && nova.vigenciaFim < nova.vigenciaInicio)
    return 'sus-permissao-vigencia-invalida';
  const fim = (x: string | null) => x ?? '9999-12-31';
  const cruza = existentesDoUsuario.some(
    (p) =>
      p.setor === nova.setor &&
      p.vigenciaInicio <= fim(nova.vigenciaFim) &&
      nova.vigenciaInicio <= fim(p.vigenciaFim),
  );
  return cruza ? 'sus-permissao-sobreposta' : null;
}

/** O encerramento: a data não antes do início nem depois do fim já marcado (encerrar só encurta). */
export function recusaEncerrarPermissaoSetorSus(
  p: PermissaoSetorSusVigencia,
  vigenciaFim: string,
): 'sus-permissao-vigencia-invalida' | null {
  if (vigenciaFim < p.vigenciaInicio) return 'sus-permissao-vigencia-invalida';
  if (p.vigenciaFim !== null && vigenciaFim > p.vigenciaFim) return 'sus-permissao-vigencia-invalida';
  return null;
}

/** Os campos de cada instrumento (os demais ficam nulos). */
export const CAMPOS_DO_INSTRUMENTO_SUS: Readonly<
  Record<InstrumentoParametroSus, readonly (keyof CamposParametroSus)[]>
> = {
  ciha: ['fontePadrao'],
  bpa: ['orgaoOrigem', 'siglaOrigem', 'cnpjPrestador', 'orgaoDestino', 'indicadorDestino'],
  apac: ['uf'],
  aih: ['utiPorAcomodacao', 'diretorClinicoCns'],
};

export interface ErroCampoParametroSus {
  readonly campo: keyof CamposParametroSus;
  readonly regra:
    'fora-do-instrumento' | 'cnpj-invalido' | 'cns-invalido' | 'uf-invalida' | 'formato-invalido';
}

/**
 * Os parâmetros do instrumento normalizados (texto aparado, vazio vira null, CNPJ só dígitos, UF e sigla em
 * maiúsculas) ou os erros por campo (a tela mostra cada um ao lado do campo, na hora).
 */
export function normalizarParametrosSus(
  instrumento: InstrumentoParametroSus,
  campos: CamposParametroSus,
): { readonly campos: CamposParametroSus; readonly erros: readonly ErroCampoParametroSus[] } {
  const erros: ErroCampoParametroSus[] = [];
  const permitidos = new Set(CAMPOS_DO_INSTRUMENTO_SUS[instrumento]);
  const limpo = (v: string | null): string | null => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  const saida: { -readonly [K in keyof CamposParametroSus]: CamposParametroSus[K] } = {
    fontePadrao: campos.fontePadrao,
    orgaoOrigem: limpo(campos.orgaoOrigem),
    siglaOrigem: limpo(campos.siglaOrigem)?.toUpperCase() ?? null,
    cnpjPrestador: limpo(campos.cnpjPrestador)?.replace(/\D/g, '') ?? null,
    orgaoDestino: limpo(campos.orgaoDestino),
    indicadorDestino: campos.indicadorDestino,
    uf: limpo(campos.uf)?.toUpperCase() ?? null,
    utiPorAcomodacao: limpo(campos.utiPorAcomodacao),
    diretorClinicoCns: limpo(campos.diretorClinicoCns)?.replace(/\D/g, '') ?? null,
  };
  for (const k of Object.keys(saida) as (keyof CamposParametroSus)[])
    if (saida[k] !== null && !permitidos.has(k)) erros.push({ campo: k, regra: 'fora-do-instrumento' });
  if (saida.cnpjPrestador !== null && !cnpjValido(saida.cnpjPrestador))
    erros.push({ campo: 'cnpjPrestador', regra: 'cnpj-invalido' });
  if (saida.diretorClinicoCns !== null && !cnsValido(saida.diretorClinicoCns))
    erros.push({ campo: 'diretorClinicoCns', regra: 'cns-invalido' });
  if (saida.uf !== null && !(UFS as readonly string[]).includes(saida.uf))
    erros.push({ campo: 'uf', regra: 'uf-invalida' });
  if (saida.siglaOrigem !== null && !/^[A-Z0-9]{1,6}$/.test(saida.siglaOrigem))
    erros.push({ campo: 'siglaOrigem', regra: 'formato-invalido' });
  if (
    saida.utiPorAcomodacao !== null &&
    !saida.utiPorAcomodacao.split(';').every((x) => /^\d+:\d+:\d{10}$/.test(x.trim()))
  )
    erros.push({ campo: 'utiPorAcomodacao', regra: 'formato-invalido' });
  return { campos: saida, erros };
}
