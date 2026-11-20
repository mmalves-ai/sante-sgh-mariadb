// Plano de contas (M54-F1; ficha, seção 6, SGH_CTB_PLANO_CONTA; tela /contabil/plano). Regras do plano:
//   - o código segue a máscara da empresa (níveis separados por ponto, tamanho fixo por nível);
//   - o pai de toda conta existe e é sintética; a conta analítica não tem filhos e é a única que recebe lançamento;
//   - o grupo é o do primeiro nível e a natureza segue o grupo (a não ser redutora, que é explícita e só analítica);
//   - a conta analítica precisa do vínculo com o plano referencial antes da ECD (aviso, não erro, até ligar o SPED).
import { GRUPOS_CONTA, type ContaPlano } from '@sgh/contratos';

export interface ProblemaPlano {
  readonly codigo: string;
  readonly regra:
    | 'mascara'
    | 'repetida'
    | 'semPai'
    | 'paiAnalitico'
    | 'analiticaComFilhos'
    | 'grupoDiferenteDoPai'
    | 'naturezaDoGrupo'
    | 'semReferencial';
  readonly gravidade: 'erro' | 'aviso';
  readonly detalhe: string;
}

/** Tamanhos dos níveis da máscara ("9.9.9.99.9999" → [1, 1, 1, 2, 4]). */
export function niveisDaMascara(mascara: string): number[] {
  const partes = mascara.split('.');
  if (partes.some((p) => !/^9+$/.test(p))) throw new RangeError(`Máscara inválida: ${mascara}`);
  return partes.map((p) => p.length);
}

/** O código obedece à máscara até o seu nível (código parcial é conta sintética de nível intermediário). */
export function codigoNaMascara(codigo: string, mascara: string): boolean {
  const niveis = niveisDaMascara(mascara);
  const partes = codigo.split('.');
  if (partes.length > niveis.length) return false;
  return partes.every((p, i) => /^\d+$/.test(p) && p.length === niveis[i]);
}

export function nivelDoCodigo(codigo: string): number {
  return codigo.split('.').length;
}

export function paiDoCodigo(codigo: string): string | null {
  const i = codigo.lastIndexOf('.');
  return i < 0 ? null : codigo.slice(0, i);
}

/** Compara códigos por nível numérico (1.10 depois de 1.9; o pai antes dos filhos). */
export function compararCodigos(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x !== y) return x - y;
  }
  return 0;
}

export interface OpcoesConferenciaPlano {
  readonly mascara: string;
  /** Exige o vínculo referencial das analíticas como erro (a ECD liga com a chave contabil.sped). */
  readonly referencialObrigatorio?: boolean;
  /** Contas redutoras (natureza invertida de propósito), por código. */
  readonly redutoras?: ReadonlySet<string>;
}

/** Todos os problemas do plano de uma empresa (vazio = plano coerente). */
export function problemasDoPlano(contas: readonly ContaPlano[], o: OpcoesConferenciaPlano): ProblemaPlano[] {
  const r: ProblemaPlano[] = [];
  const porCodigo = new Map<string, ContaPlano>();
  for (const c of contas) {
    if (porCodigo.has(c.codigo))
      r.push({
        codigo: c.codigo,
        regra: 'repetida',
        gravidade: 'erro',
        detalhe: 'Código repetido no plano.',
      });
    porCodigo.set(c.codigo, c);
  }
  const comFilhos = new Set<string>();
  for (const c of contas) {
    const pai = paiDoCodigo(c.codigo);
    if (pai) comFilhos.add(pai);
  }
  for (const c of [...porCodigo.values()].sort((a, b) => compararCodigos(a.codigo, b.codigo))) {
    if (!codigoNaMascara(c.codigo, o.mascara))
      r.push({
        codigo: c.codigo,
        regra: 'mascara',
        gravidade: 'erro',
        detalhe: `Fora da máscara ${o.mascara}.`,
      });
    const pai = paiDoCodigo(c.codigo);
    if (pai) {
      const p = porCodigo.get(pai);
      if (!p)
        r.push({
          codigo: c.codigo,
          regra: 'semPai',
          gravidade: 'erro',
          detalhe: `A conta ${pai} não existe.`,
        });
      else {
        if (p.tipo === 'analitica')
          r.push({
            codigo: c.codigo,
            regra: 'paiAnalitico',
            gravidade: 'erro',
            detalhe: `A conta ${pai} é analítica e não pode ter filhas.`,
          });
        if (p.grupo !== c.grupo)
          r.push({
            codigo: c.codigo,
            regra: 'grupoDiferenteDoPai',
            gravidade: 'erro',
            detalhe: `O grupo tem de ser o da conta ${pai}.`,
          });
      }
    }
    if (c.tipo === 'analitica' && comFilhos.has(c.codigo))
      r.push({
        codigo: c.codigo,
        regra: 'analiticaComFilhos',
        gravidade: 'erro',
        detalhe: 'Conta analítica não pode ter filhas: troque para sintética.',
      });
    const esperada = GRUPOS_CONTA[c.grupo].natureza;
    const redutora = o.redutoras?.has(c.codigo) ?? false;
    if (c.natureza !== esperada && !(redutora && c.tipo === 'analitica'))
      r.push({
        codigo: c.codigo,
        regra: 'naturezaDoGrupo',
        gravidade: 'erro',
        detalhe: `Natureza ${c.natureza} num grupo de natureza ${esperada} (só conta redutora analítica).`,
      });
    if (c.tipo === 'analitica' && c.ativa && (c.referencialTipo === null || !c.referencialConta))
      r.push({
        codigo: c.codigo,
        regra: 'semReferencial',
        gravidade: o.referencialObrigatorio ? 'erro' : 'aviso',
        detalhe: 'Sem vínculo com o plano referencial (necessário para a ECD).',
      });
  }
  return r;
}

/** A conta recebe lançamento: existe, ativa e analítica. Devolve o motivo da recusa ou null. */
export function recusaDeLancamentoNaConta(conta: ContaPlano | undefined, codigo: string): string | null {
  if (!conta) return `A conta ${codigo} não existe no plano.`;
  if (!conta.ativa) return `A conta ${codigo} está inativa.`;
  if (conta.tipo !== 'analitica')
    return `A conta ${codigo} é sintética: só conta analítica recebe lançamento.`;
  return null;
}

/** Contas do plano em árvore (para a tela): cada nó com as filhas ordenadas. */
export interface NoPlano {
  readonly conta: ContaPlano;
  readonly filhas: NoPlano[];
}

export function arvoreDoPlano(contas: readonly ContaPlano[]): NoPlano[] {
  const nos = new Map<string, NoPlano>();
  const ordenadas = [...contas].sort((a, b) => compararCodigos(a.codigo, b.codigo));
  for (const c of ordenadas) nos.set(c.codigo, { conta: c, filhas: [] });
  const raizes: NoPlano[] = [];
  for (const c of ordenadas) {
    const no = nos.get(c.codigo)!;
    const pai = paiDoCodigo(c.codigo);
    const p = pai ? nos.get(pai) : undefined;
    if (p) p.filhas.push(no);
    else raizes.push(no);
  }
  return raizes;
}
