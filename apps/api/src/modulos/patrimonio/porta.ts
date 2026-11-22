// Porta do patrimônio (M54, etapa 6): lê os domínios do patrimônio, os centros de custo e a nota fiscal de entrada, e
// os bens, movimentos, cálculos e inventários; grava com a trilha de auditoria na mesma transação.
//   - própria (`banco`): o MariaDB do cliente pelo @sgh/nucleo (porta-propria.ts);
//   - `memoria`: a sessão sintética de dev/ci (E2E) e os testes da API, com domínios e notas sintéticos;
//   - indisponível: fora de dev/ci sem o núcleo: 503 (falha fechada).
// Melhoria: o contexto é o do núcleo (cliente, estabelecimento e usuário por id) com a chave de idempotência da
// requisição, e a linha da trilha é a da tela (evento e recurso), gravada pelo Executor na transação.
import type {
  AjusteDoBem,
  AjusteNovo,
  AlteracaoDoBem,
  BemEsperado,
  BemRegistrado,
  BemDaCompetencia,
  CadastroDeBens,
  CalculoRegistrado,
  CotaRegistrada,
  DominiosPatrimonio,
  EstornoDeCalculo,
  FiltroBens,
  GrupoDoBem,
  GrupoBemNovo,
  InventarioRegistrado,
  LaudoDoBem,
  ItemDaNota,
  LeituraRegistrada,
  LeituraNova,
  MovimentoRegistrado,
  MovimentoNovo,
  NotaDeEntrada,
  PlanoDepreciacao,
  SituacaoParaAjuste,
  SituacaoParaEstornoAjuste,
  SituacaoParaEstorno,
} from './tipos.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import type { VersaoGrupoBem } from '@sgh/contratos';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { DestinoPorta } from '../cadastro/tipos.js';

export const PORTA_PATRIMONIO = Symbol('PORTA_PATRIMONIO');

/** O contexto do núcleo da sessão, com a rede, o código do estabelecimento e a chave de idempotência da gravação. */
export interface ContextoPatrimonio extends ContextoPorta {
  readonly chaveIdempotencia?: string;
}

type C = ContextoPatrimonio;

export interface PortaPatrimonio {
  readonly destino: DestinoPorta | 'indisponivel';
  dominios(c: C): Promise<DominiosPatrimonio>;
  bens(c: C, f: FiltroBens): Promise<{ bens: BemRegistrado[]; total: number }>;
  bem(c: C, id: number): Promise<BemRegistrado | null>;
  bemPorPlaqueta(c: C, plaqueta: string): Promise<BemRegistrado | null>;
  notas(
    c: C,
    ano: number,
    mes: number,
    busca?: string,
  ): Promise<{ notas: NotaDeEntrada[]; truncado: boolean }>;
  nota(c: C, id: number): Promise<NotaDeEntrada | null>;
  itensDaNota(c: C, nota: NotaDeEntrada): Promise<ItemDaNota[]>;
  itemNota(c: C, id: number): Promise<ItemDaNota | null>;
  bensParaDepreciar(
    c: C,
    empresa: number,
    competencia: string,
  ): Promise<{ bens: BemDaCompetencia[]; truncado: boolean }>;
  calculos(
    c: C,
    empresa: number,
    competencia: string,
  ): Promise<{ daCompetencia: CalculoRegistrado | null; ultimo: CalculoRegistrado | null }>;
  cotas(c: C, calculo: number): Promise<CotaRegistrada[]>;
  /** W0-08: os estornos de cálculo da competência (o histórico com motivo, data, quem e origem). */
  estornos(c: C, empresa: number, competencia: string): Promise<EstornoDeCalculo[]>;
  movimentos(
    c: C,
    f: { situacao?: string | undefined; bem?: number | undefined },
  ): Promise<MovimentoRegistrado[]>;
  movimento(c: C, id: number): Promise<MovimentoRegistrado | null>;
  ultimaSaida(c: C, bem: number): Promise<number | null>;
  inventarios(c: C): Promise<InventarioRegistrado[]>;
  inventario(c: C, id: number): Promise<InventarioRegistrado | null>;
  leituras(c: C, inventario: number): Promise<{ leituras: LeituraRegistrada[]; truncado: boolean }>;
  esperados(c: C, centro: number | null): Promise<{ bens: BemEsperado[]; truncado: boolean }>;
  /** W0-08: os grupos do bem do estabelecimento (sem nenhum gravado, a semente na versão 0), com os bens de cada um. */
  grupos(c: C): Promise<GrupoDoBem[]>;
  versoesGrupo(c: C, id: number | null): Promise<VersaoGrupoBem[]>;
  /** Revisão W0-08: as contas analíticas e ativas do plano (a conta que o grupo do bem pode indicar). */
  contasDoGrupo(c: C): Promise<{ codigo: string; nome: string }[]>;

  /** Gravações: cada uma com a trilha na mesma transação (uma linha por registro afetado). */
  cadastrar(
    c: C,
    x: CadastroDeBens,
    por: string,
    gerarPlaqueta: (n: number) => string,
    trilha: RegistroTrilhaTela,
  ): Promise<BemRegistrado[]>;
  alterar(
    c: C,
    x: AlteracaoDoBem,
    por: string,
    conferir: (antes: BemRegistrado) => string | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: BemRegistrado; depois: BemRegistrado; mudou: boolean } | null>;
  registrarMovimento(
    c: C,
    x: MovimentoNovo,
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ movimento: MovimentoRegistrado; bem: BemRegistrado }>;
  decidir(
    c: C,
    x: { id: number; versao: number; aceitar: boolean; motivo: string | null },
    por: string,
    conferir: (m: MovimentoRegistrado, bem: BemRegistrado) => string | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: MovimentoRegistrado; movimento: MovimentoRegistrado; bem: BemRegistrado } | null>;
  cancelar(
    c: C,
    x: { id: number; versao: number; motivo: string },
    por: string,
    conferir: (m: MovimentoRegistrado) => string | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: MovimentoRegistrado; movimento: MovimentoRegistrado } | null>;
  calcular(
    c: C,
    x: { empresa: number; competencia: string },
    por: string,
    montar: (d: { bens: BemDaCompetencia[]; ultimo: CalculoRegistrado | null }) => PlanoDepreciacao,
    trilha: RegistroTrilhaTela,
  ): Promise<{ calculo: CalculoRegistrado; plano: PlanoDepreciacao }>;
  /** W0-08: estorna o último cálculo vigente da competência (a regra pura decide; null pode). */
  estornar(
    c: C,
    x: { empresa: number; competencia: string; motivo: string; origem: string },
    por: string,
    conferir: (s: SituacaoParaEstorno) => { readonly codigo: string; readonly detalhe: string } | null,
    trilha: RegistroTrilhaTela,
  ): Promise<{ estorno: EstornoDeCalculo; calculo: CalculoRegistrado }>;
  abrirInventario(
    c: C,
    x: { descricao: string; centro: number | null },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<number>;
  registrarLeitura(c: C, x: LeituraNova, por: string, trilha: RegistroTrilhaTela): Promise<number>;
  /** W0-08 (M1): os ajustes de valor do bem, do mais novo ao mais antigo (os estornados com o estorno). */
  ajustes(c: C, bem: number): Promise<AjusteDoBem[]>;
  /** W0-08 (M1): registra o ajuste relendo na transação; a regra pura planeja ou recusa (409 com o código). */
  registrarAjuste(
    c: C,
    x: { bem: number; versao: number; motivo: string; hoje: string },
    por: string,
    planejar: (
      s: SituacaoParaAjuste,
    ) =>
      { ajuste: AjusteNovo } | { impedimento: { readonly codigo: string; readonly detalhe: string } },
    trilha: RegistroTrilhaTela,
  ): Promise<AjusteDoBem>;
  /** Achado 6 da revisão: os laudos anexados ao bem, do mais novo ao mais antigo. */
  laudos(c: C, bem: number): Promise<LaudoDoBem[]>;
  /** Achado 6 da revisão: o laudo pelo identificador (null: não existe neste estabelecimento). */
  laudo(c: C, id: number): Promise<LaudoDoBem | null>;
  /** Achado 6 da revisão: registra o laudo anexado (o PDF já está no disco local, pela chave). */
  anexarLaudo(
    c: C,
    x: { bem: number; nome: string; descricao: string; chave: string; sha256: string; tamanho: number },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<LaudoDoBem>;
  /** W0-08 (M1): estorna o ajuste (fato novo com motivo, data e origem); a regra pura decide. */
  estornarAjuste(
    c: C,
    x: { ajuste: number; motivo: string; origem: string; hoje: string },
    por: string,
    conferir: (s: SituacaoParaEstornoAjuste) => { readonly codigo: string; readonly detalhe: string } | null,
    trilha: RegistroTrilhaTela,
  ): Promise<AjusteDoBem>;
  /** W0-08: cancela o inventário aberto com motivo (false: não existe; as leituras ficam). */
  cancelarInventario(
    c: C,
    x: { id: number; motivo: string },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<boolean>;
  /** W0-08: grupo do bem (cada gravação com a trilha; recusas 409 como o núcleo). */
  incluirGrupo(c: C, x: GrupoBemNovo, por: string, trilha: RegistroTrilhaTela): Promise<GrupoDoBem>;
  alterarGrupo(
    c: C,
    x: GrupoBemNovo & { versaoVista: number; motivo: string },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: GrupoDoBem; depois: GrupoDoBem }>;
  situacaoGrupo(
    c: C,
    x: { codigo: string; versaoVista: number; motivo: string; ativo: boolean },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<{ antes: GrupoDoBem; depois: GrupoDoBem }>;
  excluirGrupo(
    c: C,
    x: { codigo: string; versaoVista: number; motivo: string },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<GrupoDoBem>;
  encerrarInventario(
    c: C,
    x: { id: number; esperados: number; resumo: string },
    por: string,
    trilha: RegistroTrilhaTela,
  ): Promise<boolean>;
}
export function portaPatrimonioIndisponivel(): PortaPatrimonio {
  const recusa = (): Promise<never> =>
    Promise.reject(
      new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'O banco do estabelecimento não está configurado: nada foi lido nem gravado.',
      ),
    );
  const metodos = [
    'dominios',
    'bens',
    'bem',
    'bemPorPlaqueta',
    'notas',
    'nota',
    'itensDaNota',
    'itemNota',
    'bensParaDepreciar',
    'calculos',
    'cotas',
    'estornos',
    'ajustes',
    'laudos',
    'laudo',
    'movimentos',
    'movimento',
    'ultimaSaida',
    'inventarios',
    'inventario',
    'leituras',
    'esperados',
    'grupos',
    'contasDoGrupo',
    'versoesGrupo',
    'cadastrar',
    'alterar',
    'registrarMovimento',
    'decidir',
    'cancelar',
    'calcular',
    'estornar',
    'registrarAjuste',
    'estornarAjuste',
    'anexarLaudo',
    'abrirInventario',
    'registrarLeitura',
    'encerrarInventario',
    'cancelarInventario',
    'incluirGrupo',
    'alterarGrupo',
    'situacaoGrupo',
    'excluirGrupo',
  ] as const satisfies readonly (keyof Omit<PortaPatrimonio, 'destino'>)[];
  return {
    destino: 'indisponivel',
    ...(Object.fromEntries(metodos.map((m) => [m, recusa])) as unknown as Omit<PortaPatrimonio, 'destino'>),
  };
}
