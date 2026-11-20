// Porta SINTÉTICA dos serviços compartilhados (sessão sintética de dev/ci; E2E): um registro em memória por
// estabelecimento, com as mesmas regras da porta do núcleo (só o banco do contexto; a trilha é do registrador da API).
// Um estabelecimento da lista `fora` simula o banco fora do ar.
import type {
  FiltroServicosRede,
  MudancaServicoParaGravar,
  NovoServicoParaGravar,
  ServicoCompartilhadoLido,
} from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoServicosRede, PortaServicosRede } from './porta.js';

const carimbo = (d: Date) => d.toISOString().slice(0, 23);

export class PortaServicosRedeMemoria implements PortaServicosRede {
  readonly destino = 'memoria' as const;
  private readonly bancos = new Map<string, ServicoCompartilhadoLido[]>();
  private proximo = 1;
  readonly fora = new Set<string>();

  constructor(private readonly agora: () => Date = () => new Date()) {}

  private banco(c: ContextoServicosRede): ServicoCompartilhadoLido[] {
    if (this.fora.has(c.hospital))
      throw new ErroProblema('indisponivel', 503, 'Banco do estabelecimento indisponível');
    let b = this.bancos.get(c.hospital);
    if (!b) this.bancos.set(c.hospital, (b = []));
    return b;
  }

  async listar(c: ContextoServicosRede, f: FiltroServicosRede) {
    const busca = f.busca?.trim().toLocaleLowerCase('pt-BR');
    const contem = (x: ServicoCompartilhadoLido) =>
      !busca || `${x.titulo}\n${x.descricao ?? ''}`.toLocaleLowerCase('pt-BR').includes(busca);
    const todos = this.banco(c)
      .filter(
        (x) => (!f.area || x.area === f.area) && (!f.situacao || x.situacao === f.situacao) && contem(x),
      )
      .sort((a, b) => b.registradoEm.localeCompare(a.registradoEm) || b.id - a.id);
    return { itens: todos.slice(0, f.ate), total: todos.length };
  }

  async ler(c: ContextoServicosRede, id: number) {
    return this.banco(c).find((x) => x.id === id) ?? null;
  }

  async registrar(c: ContextoServicosRede, novo: NovoServicoParaGravar, por: string) {
    const r: ServicoCompartilhadoLido = {
      estabelecimento: c.hospital,
      id: this.proximo++,
      area: novo.area,
      titulo: novo.titulo,
      descricao: novo.descricao,
      estabelecimentos: [...novo.estabelecimentos],
      situacao: 'registrada',
      registradoPor: por.slice(0, 31),
      registradoEm: carimbo(this.agora()),
      atualizadoPor: null,
      atualizadoEm: null,
    };
    this.banco(c).push(r);
    return r;
  }

  async alterar(c: ContextoServicosRede, id: number, m: MudancaServicoParaGravar, por: string) {
    const b = this.banco(c);
    const k = b.findIndex((x) => x.id === id);
    if (k < 0) return null;
    const antes = b[k]!;
    const depois: ServicoCompartilhadoLido = {
      ...antes,
      ...(m.area !== undefined ? { area: m.area } : {}),
      ...(m.titulo !== undefined ? { titulo: m.titulo } : {}),
      ...(m.descricao !== undefined ? { descricao: m.descricao } : {}),
      ...(m.estabelecimentos !== undefined ? { estabelecimentos: [...m.estabelecimentos] } : {}),
      ...(m.situacao !== undefined ? { situacao: m.situacao } : {}),
    };
    const mudou = JSON.stringify(depois) !== JSON.stringify(antes);
    if (!mudou) return { antes, depois: antes, mudou };
    const gravado = { ...depois, atualizadoPor: por.slice(0, 31), atualizadoEm: carimbo(this.agora()) };
    b[k] = gravado;
    return { antes, depois: gravado, mudou };
  }
}
