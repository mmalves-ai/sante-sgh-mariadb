// Porta do patrimônio (M54, etapa 6): lê os domínios do patrimônio, os centros de custo, as empresas e a nota fiscal de
// entrada onde estão, e os bens, movimentos, cálculos e inventários de SGH_PAT_*; grava só SGH_PAT_* numa transação
// SGH_, com a SGH_TRILHA junto.
//   - `legado`: @sgh/legado (leituras READ ONLY; SGH_PAT_* pelo escritor só SGH_);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes da API, com domínios e notas sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
import type {
  AjusteLido,
  AjusteParaGravar,
  AlteracaoBemParaGravar,
  BemEsperadoLido,
  BemLido,
  BemParaDepreciarLido,
  CadastroParaGravar,
  CalculoLido,
  CotaLida,
  DominiosPatrimonioLidos,
  EstornoCalculoLido,
  FiltroBens,
  GrupoBemLido,
  GrupoBemParaGravar,
  InventarioLido,
  LaudoLido,
  ItemNotaLidoPatrimonio,
  LeituraInventarioLida,
  LeituraParaGravar,
  LinhaTrilha,
  MovimentoBemLido,
  MovimentoParaGravar,
  NotaEntradaLida,
  PlanoParaGravar,
  SituacaoAjusteLida,
  SituacaoEstornoAjusteLida,
  SituacaoEstornoLida,
} from '@sgh/legado';
import type { VersaoGrupoBem } from '@sgh/contratos';

export const PORTA_PATRIMONIO = Symbol('PORTA_PATRIMONIO');

export interface ContextoPatrimonio {
  readonly rede: string;
  readonly hospital: string;
}

type C = ContextoPatrimonio;

export interface PortaPatrimonio {
  readonly destino: 'legado' | 'memoria' | 'indisponivel';
  dominios(c: C): Promise<DominiosPatrimonioLidos>;
  bens(c: C, f: FiltroBens): Promise<{ bens: BemLido[]; total: number }>;
  bem(c: C, id: number): Promise<BemLido | null>;
  bemPorPlaqueta(c: C, plaqueta: string): Promise<BemLido | null>;
  notas(
    c: C,
    ano: number,
    mes: number,
    busca?: string,
  ): Promise<{ notas: NotaEntradaLida[]; truncado: boolean }>;
  nota(c: C, id: number): Promise<NotaEntradaLida | null>;
  itensDaNota(c: C, nota: NotaEntradaLida): Promise<ItemNotaLidoPatrimonio[]>;
  itemNota(c: C, id: number): Promise<ItemNotaLidoPatrimonio | null>;
  bensParaDepreciar(
    c: C,
    empresa: number,
    competencia: string,
  ): Promise<{ bens: BemParaDepreciarLido[]; truncado: boolean }>;
  calculos(
    c: C,
    empresa: number,
    competencia: string,
  ): Promise<{ daCompetencia: CalculoLido | null; ultimo: CalculoLido | null }>;
  cotas(c: C, calculo: number): Promise<CotaLida[]>;
  /** W0-08: os estornos de cálculo da competência (o histórico com motivo, data, quem e origem). */
  estornos(c: C, empresa: number, competencia: string): Promise<EstornoCalculoLido[]>;
  movimentos(
    c: C,
    f: { situacao?: string | undefined; bem?: number | undefined },
  ): Promise<MovimentoBemLido[]>;
  movimento(c: C, id: number): Promise<MovimentoBemLido | null>;
  ultimaSaida(c: C, bem: number): Promise<number | null>;
  inventarios(c: C): Promise<InventarioLido[]>;
  inventario(c: C, id: number): Promise<InventarioLido | null>;
  leituras(c: C, inventario: number): Promise<{ leituras: LeituraInventarioLida[]; truncado: boolean }>;
  esperados(c: C, centro: number | null): Promise<{ bens: BemEsperadoLido[]; truncado: boolean }>;
  /** W0-08: os grupos do bem do estabelecimento (sem nenhum gravado, a semente na versão 0), com os bens de cada um. */
  grupos(c: C): Promise<GrupoBemLido[]>;
  versoesGrupo(c: C, id: number | null): Promise<VersaoGrupoBem[]>;
  /** Revisão W0-08: as contas analíticas e ativas do plano (a conta que o grupo do bem pode indicar). */
  contasDoGrupo(c: C): Promise<{ codigo: string; nome: string }[]>;

  /** Gravações: cada uma com a trilha na mesma transação (uma linha por registro afetado). */
  cadastrar(
    c: C,
    x: CadastroParaGravar,
    por: string,
    gerarPlaqueta: (n: number) => string,
    trilha: LinhaTrilha,
  ): Promise<BemLido[]>;
  alterar(
    c: C,
    x: AlteracaoBemParaGravar,
    por: string,
    conferir: (antes: BemLido) => string | null,
    trilha: LinhaTrilha,
  ): Promise<{ antes: BemLido; depois: BemLido; mudou: boolean } | null>;
  registrarMovimento(
    c: C,
    x: MovimentoParaGravar,
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ movimento: MovimentoBemLido; bem: BemLido }>;
  decidir(
    c: C,
    x: { id: number; versao: number; aceitar: boolean; motivo: string | null },
    por: string,
    conferir: (m: MovimentoBemLido, bem: BemLido) => string | null,
    trilha: LinhaTrilha,
  ): Promise<{ antes: MovimentoBemLido; movimento: MovimentoBemLido; bem: BemLido } | null>;
  cancelar(
    c: C,
    x: { id: number; versao: number; motivo: string },
    por: string,
    conferir: (m: MovimentoBemLido) => string | null,
    trilha: LinhaTrilha,
  ): Promise<{ antes: MovimentoBemLido; movimento: MovimentoBemLido } | null>;
  calcular(
    c: C,
    x: { empresa: number; competencia: string },
    por: string,
    montar: (d: { bens: BemParaDepreciarLido[]; ultimo: CalculoLido | null }) => PlanoParaGravar,
    trilha: LinhaTrilha,
  ): Promise<{ calculo: CalculoLido; plano: PlanoParaGravar }>;
  /** W0-08: estorna o último cálculo vigente da competência (a regra pura decide; null pode). */
  estornar(
    c: C,
    x: { empresa: number; competencia: string; motivo: string; origem: string },
    por: string,
    conferir: (s: SituacaoEstornoLida) => { readonly codigo: string; readonly detalhe: string } | null,
    trilha: LinhaTrilha,
  ): Promise<{ estorno: EstornoCalculoLido; calculo: CalculoLido }>;
  abrirInventario(
    c: C,
    x: { descricao: string; centro: number | null },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<number>;
  registrarLeitura(c: C, x: LeituraParaGravar, por: string, trilha: LinhaTrilha): Promise<number>;
  /** W0-08 (M1): os ajustes de valor do bem, do mais novo ao mais antigo (os estornados com o estorno). */
  ajustes(c: C, bem: number): Promise<AjusteLido[]>;
  /** W0-08 (M1): registra o ajuste relendo na transação; a regra pura planeja ou recusa (409 com o código). */
  registrarAjuste(
    c: C,
    x: { bem: number; versao: number; motivo: string; hoje: string },
    por: string,
    planejar: (
      s: SituacaoAjusteLida,
    ) =>
      { ajuste: AjusteParaGravar } | { impedimento: { readonly codigo: string; readonly detalhe: string } },
    trilha: LinhaTrilha,
  ): Promise<AjusteLido>;
  /** Achado 6 da revisão: os laudos anexados ao bem, do mais novo ao mais antigo. */
  laudos(c: C, bem: number): Promise<LaudoLido[]>;
  /** Achado 6 da revisão: o laudo pelo identificador (null: não existe neste estabelecimento). */
  laudo(c: C, id: number): Promise<LaudoLido | null>;
  /** Achado 6 da revisão: registra o laudo anexado (o PDF já está no armazenamento com Object Lock, pela chave). */
  anexarLaudo(
    c: C,
    x: { bem: number; nome: string; descricao: string; chave: string; sha256: string; tamanho: number },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<LaudoLido>;
  /** W0-08 (M1): estorna o ajuste (fato novo com motivo, data e origem); a regra pura decide. */
  estornarAjuste(
    c: C,
    x: { ajuste: number; motivo: string; origem: string; hoje: string },
    por: string,
    conferir: (s: SituacaoEstornoAjusteLida) => { readonly codigo: string; readonly detalhe: string } | null,
    trilha: LinhaTrilha,
  ): Promise<AjusteLido>;
  /** W0-08: cancela o inventário aberto com motivo (false: não existe; as leituras ficam). */
  cancelarInventario(
    c: C,
    x: { id: number; motivo: string },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<boolean>;
  /** W0-08: grupo do bem (cada gravação com a trilha; recusas 409 como o núcleo). */
  incluirGrupo(c: C, x: GrupoBemParaGravar, por: string, trilha: LinhaTrilha): Promise<GrupoBemLido>;
  alterarGrupo(
    c: C,
    x: GrupoBemParaGravar & { versaoVista: number; motivo: string },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ antes: GrupoBemLido; depois: GrupoBemLido }>;
  situacaoGrupo(
    c: C,
    x: { codigo: string; versaoVista: number; motivo: string; ativo: boolean },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<{ antes: GrupoBemLido; depois: GrupoBemLido }>;
  excluirGrupo(
    c: C,
    x: { codigo: string; versaoVista: number; motivo: string },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<GrupoBemLido>;
  encerrarInventario(
    c: C,
    x: { id: number; esperados: number; resumo: string },
    por: string,
    trilha: LinhaTrilha,
  ): Promise<boolean>;
}
