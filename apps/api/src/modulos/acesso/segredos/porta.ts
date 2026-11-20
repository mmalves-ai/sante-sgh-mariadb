// M59-F3 (ficha do M59, seção 5 e regra 7; cap-08 §8.11): a porta das telas dos segredos de parceiros e das senhas
// secundárias. A do adaptador lê pelo @sgh/legado (nunca o valor do segredo) e grava o registro do cofre pela transação
// SGH_ (com a trilha); a retirada no banco é a receita, pelo executor. A de memória serve o dev e o CI sem banco.
import type { GuardaSegredo, SegredosLidos, SenhasSecundariasLidas, TrilhaSegredo } from '@sgh/legado';

export const PORTA_SEGREDOS = Symbol('PORTA_SEGREDOS');
/** A execução das receitas do legado (o executor do M04, com o estado do catálogo por estabelecimento). */
export const EXECUTOR_SEGREDOS = Symbol('EXECUTOR_SEGREDOS');
/** O cofre das credenciais de parceiro (o mesmo do M49: arquivo cifrado fora do repositório; memória em dev/ci). */
export const COFRE_SEGREDOS = Symbol('COFRE_SEGREDOS');

export interface ContextoSegredos {
  readonly rede: string;
  readonly hospital: string;
}

export interface PortaSegredos {
  readonly destino: 'legado' | 'memoria';
  lerSegredos(c: ContextoSegredos): Promise<SegredosLidos>;
  registrarGuarda(
    c: ContextoSegredos,
    g: Omit<GuardaSegredo, 'hospital'>,
    trilha: TrilhaSegredo,
  ): Promise<{ id: string; novo: boolean }>;
  lerSenhasSecundarias(
    c: ContextoSegredos,
    f: { readonly busca?: string; readonly pagina: number; readonly tamanho: number },
  ): Promise<SenhasSecundariasLidas>;
}
