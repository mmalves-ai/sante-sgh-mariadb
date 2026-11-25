// 02-REC linha 33: porta do cadastro da estrutura da recepção (pontos de recepção, guichês e serviços de senha).
// O hospital novo monta a recepção pela tela, sem carga prévia. Nada é apagado: o item sai de uso desativado, com
// motivo, e só sem atendimento em curso nele (regra em @sgh/dominio-recepcao, estrutura.ts).
//   - `propria`: o banco do cliente (estrutura-propria.ts), com a trilha na mesma transação;
//   - `memoria`: a sessão sintética de dev/ci (E2E), com as mesmas regras do domínio;
//   - sem nenhuma das duas, o controlador responde 503 (falha fechada).
import type {
  AlterarGuicheRecepcao,
  AlterarPontoRecepcao,
  AlterarServicoSenha,
  EstruturaRecepcao,
  GuicheDaEstrutura,
  IncluirGuicheRecepcao,
  IncluirPontoRecepcao,
  IncluirServicoSenha,
  PontoDaEstrutura,
  ServicoDaEstrutura,
  SituacaoEstrutura,
} from '@sgh/contratos';
import {
  bloqueioDesativar,
  ordenarBotoes,
  type RecusaEstrutura,
  recusasDoGuiche,
  recusasDoPonto,
  recusasDoServico,
} from '@sgh/dominio-recepcao';
import { ErroOperacao } from '@sgh/nucleo';
import type { PortaRecepcao } from './porta.js';
import type { ContextoRecepcao } from './tipos.js';

export const PORTA_ESTRUTURA_RECEPCAO = Symbol('PORTA_ESTRUTURA_RECEPCAO');

/** Quem grava e de onde (vai à trilha). */
export interface AutorEstrutura {
  readonly login: string;
  readonly correlacao: string;
  readonly estacao?: string;
}

export type ItemEstrutura = 'ponto' | 'guiche' | 'servico';

export interface PortaEstruturaRecepcao {
  readonly destino: 'propria' | 'memoria';
  ler(c: ContextoRecepcao): Promise<EstruturaRecepcao>;
  incluirPonto(c: ContextoRecepcao, a: AutorEstrutura, p: IncluirPontoRecepcao): Promise<number>;
  alterarPonto(c: ContextoRecepcao, a: AutorEstrutura, id: number, p: AlterarPontoRecepcao): Promise<void>;
  incluirGuiche(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    ponto: number,
    g: IncluirGuicheRecepcao,
  ): Promise<number>;
  alterarGuiche(c: ContextoRecepcao, a: AutorEstrutura, id: number, g: AlterarGuicheRecepcao): Promise<void>;
  incluirServico(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    ponto: number,
    s: IncluirServicoSenha,
  ): Promise<number>;
  alterarServico(c: ContextoRecepcao, a: AutorEstrutura, id: number, s: AlterarServicoSenha): Promise<void>;
  /** Desativa (com motivo) ou reativa; nunca apaga. */
  situacao(
    c: ContextoRecepcao,
    a: AutorEstrutura,
    item: ItemEstrutura,
    id: number,
    s: SituacaoEstrutura,
  ): Promise<void>;
}

/** A primeira recusa do domínio vira a resposta 409 com o campo (a tela marca o campo e mostra o texto). */
export function exigirSemRecusa(recusas: readonly (RecusaEstrutura | null)[]): void {
  const r = recusas.find((x) => x !== null);
  if (r) throw new ErroOperacao(409, r.codigo, 'Cadastro recusado', r.mensagem, { campos: [r.campo] });
}

export const naoEncontrado = (oQue: string): ErroOperacao =>
  new ErroOperacao(
    404,
    'nao-encontrado',
    'Registro não encontrado',
    `${oQue} não existe neste estabelecimento.`,
  );

export const versaoAntiga = (): ErroOperacao =>
  new ErroOperacao(
    409,
    'versao-desatualizada',
    'Cadastro alterado por outra pessoa',
    'O registro mudou depois que a tela foi aberta: recarregue e repita a alteração.',
  );

/** O tipo gravado: geral e diverso pela tela; os demais tipos já cadastrados ficam como estão. */
export const tipoAGravar = (pedido: string, atual: string | null): string =>
  atual !== null && atual !== 'geral' && atual !== 'diverso' ? atual : pedido;

/** O tipo que a regra confere: o tipo preservado (agenda, especialidade, profissional) não é julgado pela tela. */
export const tipoAConferir = (pedido: string, atual: string | null): string =>
  tipoAGravar(pedido, atual) === pedido ? pedido : 'geral';

// ── memória (dev/ci) ─────────────────────────────────────────────────────────────────────────────────────

const GRUPOS_SINTETICOS = [
  { codigo: 'idoso_80', descricao: 'Acima de 80 anos' },
  { codigo: 'idoso_60', descricao: '60 a 79 anos' },
  { codigo: 'gestante', descricao: 'Gestante' },
  { codigo: 'pessoa_deficiencia', descricao: 'Pessoa com deficiência' },
];

type PontoMem = Omit<PontoDaEstrutura, 'guiches' | 'servicos'> & {
  guiches: GuicheDaEstrutura[];
  servicos: ServicoDaEstrutura[];
};

/** Estrutura sintética em memória, semeada das recepções sintéticas da porta da recepção. */
export class EstruturaRecepcaoMemoria implements PortaEstruturaRecepcao {
  readonly destino = 'memoria' as const;
  private readonly estados = new Map<string, PontoMem[]>();
  private sequencia = 9000;

  constructor(private readonly recepcao: Pick<PortaRecepcao, 'recepcoes' | 'guichesEmUso'>) {}

  private async pontos(c: ContextoRecepcao): Promise<PontoMem[]> {
    let s = this.estados.get(c.hospital);
    if (!s) {
      s = (await this.recepcao.recepcoes(c)).map((r) => ({
        id: r.id,
        codigo: `REC-${r.id}`,
        descricao: r.descricao,
        textoSenha: null,
        ativo: true,
        versao: 1,
        guiches: r.guiches.map((n) => ({
          id: r.id * 1000 + n,
          numero: n,
          descricao: null,
          ativo: true,
          aberto: false,
          versao: 1,
        })),
        servicos: r.geradores.map((g) => ({
          id: g.id,
          prefixo: g.letra,
          descricao: g.nome,
          tipo: g.tipo === 'diverso' ? 'diverso' : 'geral',
          prioritaria: g.prioritaria,
          grupoPrioridade: null,
          limiteDia: g.limiteDia,
          ordemBotao: null,
          ativo: g.ativo,
          versao: 1,
        })),
      }));
      this.estados.set(c.hospital, s);
    }
    return s;
  }

  async ler(c: ContextoRecepcao): Promise<EstruturaRecepcao> {
    const abertos = await this.recepcao.guichesEmUso(c);
    return {
      pontos: (await this.pontos(c)).map((p) => ({
        ...p,
        guiches: [...p.guiches]
          .sort((a, b) => a.numero - b.numero)
          .map((g) => ({
            ...g,
            aberto: abertos.some((x) => x.recepcao === p.id && x.guiche === g.numero),
          })),
        servicos: ordenarBotoes(p.servicos),
      })),
      gruposPrioridade: GRUPOS_SINTETICOS,
    };
  }

  private async ponto(c: ContextoRecepcao, id: number): Promise<PontoMem> {
    const p = (await this.pontos(c)).find((x) => x.id === id);
    if (!p) throw naoEncontrado('A recepção');
    return p;
  }

  async incluirPonto(c: ContextoRecepcao, _a: AutorEstrutura, p: IncluirPontoRecepcao): Promise<number> {
    const todos = await this.pontos(c);
    exigirSemRecusa(recusasDoPonto(p, todos));
    const id = ++this.sequencia;
    todos.push({ id, ...p, ativo: true, versao: 1, guiches: [], servicos: [] });
    return id;
  }

  async alterarPonto(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    id: number,
    p: AlterarPontoRecepcao,
  ): Promise<void> {
    const atual = await this.ponto(c, id);
    if (atual.versao !== p.versao) throw versaoAntiga();
    exigirSemRecusa(recusasDoPonto(p, await this.pontos(c), id));
    Object.assign(atual, {
      codigo: p.codigo,
      descricao: p.descricao,
      textoSenha: p.textoSenha,
      versao: atual.versao + 1,
    });
  }

  async incluirGuiche(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    ponto: number,
    g: IncluirGuicheRecepcao,
  ): Promise<number> {
    const p = await this.ponto(c, ponto);
    exigirSemRecusa(recusasDoGuiche(g, p.guiches));
    const id = ++this.sequencia;
    p.guiches.push({ id, ...g, ativo: true, aberto: false, versao: 1 });
    return id;
  }

  async alterarGuiche(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    id: number,
    g: AlterarGuicheRecepcao,
  ): Promise<void> {
    const p = (await this.pontos(c)).find((x) => x.guiches.some((y) => y.id === id));
    const atual = p?.guiches.find((y) => y.id === id);
    if (!p || !atual) throw naoEncontrado('O guichê');
    if (atual.versao !== g.versao) throw versaoAntiga();
    exigirSemRecusa(recusasDoGuiche(g, p.guiches, id));
    Object.assign(atual, { numero: g.numero, descricao: g.descricao, versao: atual.versao + 1 });
  }

  async incluirServico(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    ponto: number,
    s: IncluirServicoSenha,
  ): Promise<number> {
    const p = await this.ponto(c, ponto);
    exigirSemRecusa(
      recusasDoServico(
        s,
        p.servicos,
        GRUPOS_SINTETICOS.map((x) => x.codigo),
      ),
    );
    const id = ++this.sequencia;
    p.servicos.push({ id, ...s, ativo: true, versao: 1 });
    return id;
  }

  async alterarServico(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    id: number,
    s: AlterarServicoSenha,
  ): Promise<void> {
    const p = (await this.pontos(c)).find((x) => x.servicos.some((y) => y.id === id));
    const atual = p?.servicos.find((y) => y.id === id);
    if (!p || !atual) throw naoEncontrado('O serviço de senha');
    if (atual.versao !== s.versao) throw versaoAntiga();
    const tipo = tipoAGravar(s.tipo, atual.tipo);
    exigirSemRecusa(
      recusasDoServico(
        { ...s, tipo: tipoAConferir(s.tipo, atual.tipo) },
        p.servicos,
        GRUPOS_SINTETICOS.map((x) => x.codigo),
        id,
      ),
    );
    Object.assign(atual, { ...s, tipo, versao: atual.versao + 1 });
  }

  async situacao(
    c: ContextoRecepcao,
    _a: AutorEstrutura,
    item: ItemEstrutura,
    id: number,
    s: SituacaoEstrutura,
  ): Promise<void> {
    const todos = await this.pontos(c);
    const abertos = await this.recepcao.guichesEmUso(c);
    let alvo: { ativo: boolean; versao: number } | undefined;
    let guichesAbertos = 0;
    if (item === 'ponto') {
      alvo = todos.find((x) => x.id === id);
      guichesAbertos = abertos.filter((x) => x.recepcao === id).length;
    } else if (item === 'guiche') {
      const p = todos.find((x) => x.guiches.some((y) => y.id === id));
      const g = p?.guiches.find((y) => y.id === id);
      alvo = g;
      guichesAbertos = abertos.filter((x) => x.recepcao === p?.id && x.guiche === g?.numero).length;
    } else alvo = todos.flatMap((x) => x.servicos).find((y) => y.id === id);
    if (!alvo) throw naoEncontrado('O registro');
    if (alvo.versao !== s.versao) throw versaoAntiga();
    if (!s.ativo) exigirSemRecusa([bloqueioDesativar(item, { guichesAbertos, senhasEmAberto: 0 })]);
    alvo.ativo = s.ativo;
    alvo.versao += 1;
  }
}
