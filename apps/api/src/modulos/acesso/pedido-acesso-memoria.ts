// W1-01 (parte 10b): o PEDIDO DE ACESSO na memória (dev/ci; E2E), como SGH_ACESSO_PEDIDO (SGH_ 1207) com as mesmas
// travas e recusas de legado/acesso/gravacao/pedido-acesso-sgh.ts: pedir (sem repetir o perfil em andamento),
// decidir o nível esperado (com o validador do domínio), anotar a concessão só do aprovado, cancelar só pelo
// solicitante antes da concessão. Nada se apaga. Nenhum dado real.
import { ErroOperacao } from '@sgh/nucleo';
import {
  type DecisaoPedidoAcessoGravar,
  type FiltroPedidosAcesso,
  type NovoPedidoAcessoGravar,
  type PedidoAcessoGravado,
  type SituacaoPedidoAcesso,
  type ValidarPedidoAcesso,
} from './tipos-gestao-acesso.js';

const recusa = (codigo: string, detalhe: string) =>
  new ErroOperacao(409, codigo, 'Operação recusada', detalhe);

type Mutavel<T> = { -readonly [K in keyof T]: T[K] };
const EM_ANDAMENTO: readonly SituacaoPedidoAcesso[] = ['pendente', 'aprovado-setor', 'aprovado'];
/** Achado 2 da revisão: 'aprovado' (concessão a caminho) não se cancela. */
const CANCELAVEL: readonly SituacaoPedidoAcesso[] = ['pendente', 'aprovado-setor'];
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const mesmo = (a: string | null, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();

export class PedidoAcessoMemoria {
  private readonly pedidos: Mutavel<PedidoAcessoGravado>[] = [];

  ler(filtro: FiltroPedidosAcesso = {}): PedidoAcessoGravado[] {
    return [...this.pedidos]
      .reverse()
      .filter((p) => !filtro.login || p.login === filtro.login)
      .filter((p) => !filtro.situacoes?.length || filtro.situacoes.includes(p.situacao))
      .map((p) => ({ ...p }));
  }

  lerUm(id: string): PedidoAcessoGravado | null {
    const p = this.pedidos.find((x) => x.id === id);
    return p ? { ...p } : null;
  }

  private travado(id: string): Mutavel<PedidoAcessoGravado> {
    const p = this.pedidos.find((x) => x.id === id);
    if (!p) throw recusa('pedido-inexistente', 'Pedido de acesso não encontrado.');
    return p;
  }

  pedir(p: NovoPedidoAcessoGravar): { id: string } {
    const perfil = p.perfil.trim();
    const setor = p.setor.trim();
    const motivo = p.motivo.trim();
    if (!perfil) throw recusa('perfil-obrigatorio', 'Escolha o perfil que você precisa.');
    if (!setor) throw recusa('setor-obrigatorio', 'Escolha o setor onde o acesso será usado.');
    if (!DIA.test(p.inicio) || !DIA.test(p.fim) || p.inicio < p.hoje || p.fim < p.inicio)
      throw recusa('periodo-invalido', 'O período vai de hoje em diante e o fim fica no início ou depois.');
    if (motivo.length < 10)
      throw recusa('motivo-curto', 'Explique para que precisa do acesso (ao menos 10 caracteres).');
    if (
      this.pedidos.some(
        (x) => x.login === p.login && x.perfil === perfil && EM_ANDAMENTO.includes(x.situacao),
      )
    )
      throw recusa('pedido-repetido', 'Já há um pedido deste perfil em andamento.');
    const id = String(this.pedidos.length + 1);
    this.pedidos.push({
      id,
      login: p.login,
      perfil,
      setor,
      inicio: p.inicio,
      fim: p.fim,
      motivo,
      situacao: 'pendente',
      criadoEm: new Date(),
      setorPor: null,
      setorEm: null,
      acessosPor: null,
      acessosEm: null,
      fechadoPor: null,
      fechadoEm: null,
      motivoFechamento: null,
      concessao: null,
    });
    return { id };
  }

  /**
   * `conceder` (achado 2 da revisão): no 2º nível aprovado, concede na mesma "transação" e anota (-> concedido); se a
   * concessão falhar, a decisão é desfeita (o pedido volta a 'aprovado-setor'), como o rollback da SGH_.
   */
  decidir(
    p: DecisaoPedidoAcessoGravar,
    validar: ValidarPedidoAcesso,
    conceder?: () => string,
  ): { id: string; anterior: SituacaoPedidoAcesso; situacao: SituacaoPedidoAcesso } {
    const x = this.travado(p.pedido);
    if (x.situacao !== 'pendente' && x.situacao !== 'aprovado-setor')
      throw recusa('pedido-fechado', 'Este pedido não espera decisão (já decidido ou cancelado).');
    if (mesmo(x.login, p.por)) throw recusa('decidir-a-si', 'Ninguém decide o próprio pedido de acesso.');
    if (x.situacao === 'aprovado-setor' && mesmo(x.setorPor, p.por))
      throw recusa('mesmo-aprovador', 'Os dois níveis têm de ser aprovados por pessoas diferentes.');
    const motivo = p.motivo.trim();
    if (p.decisao === 'recusar' && motivo.length < 10)
      throw recusa('motivo-curto', 'Justifique a recusa (ao menos 10 caracteres).');
    const r = validar({ ...x });
    if (r) throw recusa(r.codigo, r.mensagem);
    const anterior = x.situacao;
    const agora = new Date();
    if (p.decisao === 'recusar') {
      Object.assign(x, {
        situacao: 'recusado',
        fechadoPor: p.por,
        fechadoEm: agora,
        motivoFechamento: motivo,
      });
    } else if (anterior === 'pendente') {
      Object.assign(x, { situacao: 'aprovado-setor', setorPor: p.por, setorEm: agora });
    } else {
      const antes = { ...x };
      Object.assign(x, { situacao: 'aprovado', acessosPor: p.por, acessosEm: agora });
      if (conceder)
        try {
          Object.assign(x, { situacao: 'concedido', concessao: conceder() });
        } catch (e) {
          Object.assign(x, antes);
          throw e;
        }
    }
    return { id: x.id, anterior, situacao: x.situacao };
  }

  anotarConcessao(pedido: string, concessao: string): { id: string; concessao: string } {
    const x = this.travado(pedido);
    if (x.situacao !== 'aprovado')
      throw recusa('pedido-nao-aprovado', 'Só o pedido aprovado nos dois níveis recebe a concessão.');
    Object.assign(x, { situacao: 'concedido', concessao });
    return { id: x.id, concessao };
  }

  cancelar(pedido: string, por: string, motivo: string): { id: string; anterior: SituacaoPedidoAcesso } {
    if (motivo.trim().length < 10)
      throw recusa('motivo-curto', 'Diga por que cancela (ao menos 10 caracteres).');
    const x = this.travado(pedido);
    if (x.situacao === 'aprovado')
      throw recusa(
        'pedido-aprovado',
        'Este pedido já foi aprovado nos dois níveis: peça a revogação do perfil.',
      );
    if (!CANCELAVEL.includes(x.situacao))
      throw recusa('pedido-fechado', 'Este pedido já foi concedido, recusado ou cancelado.');
    if (!mesmo(x.login, por)) throw recusa('cancelar-de-outro', 'Só quem pediu pode cancelar o pedido.');
    const anterior = x.situacao;
    Object.assign(x, {
      situacao: 'cancelado',
      fechadoPor: por,
      fechadoEm: new Date(),
      motivoFechamento: motivo.trim(),
    });
    return { id: x.id, anterior };
  }
}
