// Porta do painel de migração gradual em MEMÓRIA (M37): a sessão sintética de dev/ci (E2E). As pessoas são as contas
// sintéticas do estado de acesso (grupo e ID) mais uma turma sintética (SINT.TURMA01 a 12, grupo ATENDIMENTO), as
// conexões do outro sistema são sintéticas, as permissões dos grupos vêm do estado sintético (a mesma que a condução
// muda pela fonte da administração em memória) e as chaves de liberação, da fonte de configuração em memória (a mesma
// da tela de funcionalidades). Nada vai à cópia; a SGH_TRILHA vai ao registrador da API.
import type {
  ChamadoLidoBanco,
  ConclusaoLida,
  ConducaoLida,
  FiltroChamados,
  LinhaTrilha,
  LoteCoexLido,
  PessoaCoexLida,
  SetorCoexLido,
  TrilhaLida,
  ItemLigarLido,
  ItemDesligamentoLido,
  UsoDiaLido,
  VersaoRegistroCoexLida,
} from '@sgh/legado';
import { CONTAS_TECNICAS_DECLARADAS, FUNCOES_EXTERNAS_ESPERADAS } from '@sgh/contratos';
import { type RegistradorTrilha, RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { CONTAS_SINTETICAS, estadoAcessoSintetico } from '../acesso/fonte-sintetica.js';
import type { FonteConfiguracao } from '../config/public-api.js';
import type {
  ContextoCoex,
  EventoCicloCoex,
  GravadorCoex,
  LeituraDesligamento,
  PortaCoexistencia,
} from './porta.js';

/** A turma sintética do E2E (12 pessoas da recepção, sem dado real). */
export const TURMA_SINTETICA = Array.from(
  { length: 12 },
  (_, i) => `SINT.TURMA${String(i + 1).padStart(2, '0')}`,
);

export class PortaCoexistenciaMemoria implements PortaCoexistencia {
  readonly destino = 'memoria' as const;
  private readonly setoresDe = new Map<string, SetorCoexLido[]>();
  private readonly trilhasDe = new Map<string, TrilhaLida[]>();
  private readonly conclusoesDe = new Map<string, ConclusaoLida[]>();
  private readonly usoDe = new Map<string, UsoDiaLido[]>();
  private readonly lotesDe = new Map<string, LoteCoexLido[]>();
  private readonly conducoesDe = new Map<string, ConducaoLida[]>();
  private readonly chamadosDe = new Map<string, ChamadoLidoBanco[]>();
  private readonly ligarDe = new Map<string, ItemLigarLido[]>();
  private readonly desligDe = new Map<string, ItemDesligamentoLido[]>();
  /** W0-09: os estornos (id da conclusão → quem e o motivo), os eventos do ciclo e os retratos da exclusão. */
  private readonly estornosDe = new Map<string, { id: string; motivo: string; por: string; em: string }[]>();
  private readonly eventosDe = new Map<string, (EventoCicloCoex & { em: string })[]>();
  private readonly registrosDe = new Map<string, (VersaoRegistroCoexLida & { tipo: string })[]>();
  private readonly retratosDe = new Map<
    string,
    { tabela: string; chave: string; linha: unknown; motivo: string }[]
  >();
  private seq = 0;

  constructor(
    private readonly trilha: RegistradorTrilha,
    private readonly config: FonteConfiguracao,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private de<T>(m: Map<string, T[]>, h: string): T[] {
    if (!m.has(h)) m.set(h, []);
    return m.get(h)!;
  }

  private proximo(): string {
    this.seq += 1;
    return String(this.seq);
  }

  /** Relógio de parede (America/Sao_Paulo) nos campos UTC, como as datas lidas do banco. */
  private parede(): Date {
    const a = this.agora();
    return new Date(a.getTime() - 3 * 3_600_000);
  }

  relogio() {
    const agora = this.parede();
    return Promise.resolve({ agora, hoje: agora.toISOString().slice(0, 10) });
  }

  pessoas(): Promise<PessoaCoexLida[]> {
    const estado = estadoAcessoSintetico();
    const r: PessoaCoexLida[] = [...estado.contas.entries()].map(([login, c]) => ({
      id: c.id,
      login,
      nome: null,
      grupo: c.grupo,
      unidades: [],
      locais: [],
    }));
    TURMA_SINTETICA.forEach((login, i) =>
      r.push({ id: 900_000 + i, login, nome: null, grupo: 'ATENDIMENTO', unidades: [1], locais: [] }),
    );
    return Promise.resolve(r.sort((a, b) => a.login.localeCompare(b.login)));
  }

  conexoesOutro() {
    const base = this.parede().getTime();
    return Promise.resolve(
      TURMA_SINTETICA.map((login, i) => ({ login, modulo: 1, ultima: new Date(base - i * 86_400_000) })),
    );
  }

  /** O último dia na trilha da API (o registrador em memória) de cada login pedido, desde `desde`. */
  ultimoUsoNovo(c: ContextoCoex, logins: readonly string[], desde: string) {
    const pedidos = new Set(logins.map((l) => l.toUpperCase()));
    const ultimo = new Map<string, string>();
    const eventos = this.trilha instanceof RegistradorTrilhaMemoria ? this.trilha.eventos : [];
    for (const e of eventos) {
      const login = (e.usuario ?? '').toUpperCase();
      if (e.hospital !== c.hospital || !pedidos.has(login)) continue;
      // O dia civil do evento (relógio de parede, como o DIA da SGH_TRILHA).
      const dia = new Date(Date.parse(e.em) - 3 * 3_600_000).toISOString().slice(0, 10);
      if (dia >= desde && dia > (ultimo.get(login) ?? '')) ultimo.set(login, dia);
    }
    return Promise.resolve([...ultimo.entries()].map(([login, dia]) => ({ login, dia })));
  }

  async publicoPorGrupo() {
    const porGrupo: Record<string, number> = {};
    for (const p of await this.pessoas())
      porGrupo[p.grupo ?? 'SEM GRUPO'] = (porGrupo[p.grupo ?? 'SEM GRUPO'] ?? 0) + 1;
    return { porGrupo, total: Object.values(porGrupo).reduce((t, n) => t + n, 0) };
  }

  setores(c: ContextoCoex) {
    return Promise.resolve(this.de(this.setoresDe, c.hospital).map((s) => ({ ...s })));
  }
  trilhas(c: ContextoCoex) {
    return Promise.resolve([...this.de(this.trilhasDe, c.hospital)]);
  }
  conclusoes(c: ContextoCoex) {
    const estornadas = new Set(this.de(this.estornosDe, c.hospital).map((x) => x.id));
    return Promise.resolve(this.de(this.conclusoesDe, c.hospital).filter((x) => !estornadas.has(x.id)));
  }
  /** Só na memória (testes): os eventos do ciclo de vida (o que a SGH_CRUD_EVENTO guarda no banco). */
  eventosCiclo(c: ContextoCoex): readonly (EventoCicloCoex & { em: string })[] {
    return [...this.de(this.eventosDe, c.hospital)];
  }
  /** Só na memória (testes): os retratos da exclusão física (o que a SGH_HIST_EXCLUSAO guarda no banco). */
  retratosExclusao(
    c: ContextoCoex,
  ): readonly { tabela: string; chave: string; linha: unknown; motivo: string }[] {
    return [...this.de(this.retratosDe, c.hospital)];
  }
  retratos() {
    return Promise.resolve([]);
  }
  usoDia(c: ContextoCoex, desde: string) {
    return Promise.resolve(this.de(this.usoDe, c.hospital).filter((u) => u.dia >= desde));
  }
  usoAoVivo() {
    return Promise.resolve([
      { operacao: 'agenda.agendarConsulta', setor: 'agendamento', linhasDoDia: 100, doNovo: 61 },
      { operacao: 'recepcao.emitirSenha', setor: 'recepcao-ambulatorial', linhasDoDia: 40, doNovo: 0 },
      // M39: senhas chamadas no dia pelos dois sistemas (o indicador "senhas chamadas por sistema").
      { operacao: 'recepcao.chamarSenha', setor: 'recepcao-ambulatorial', linhasDoDia: 30, doNovo: 12 },
    ]);
  }
  lotes(c: ContextoCoex, id?: string) {
    const l = this.de(this.lotesDe, c.hospital);
    return Promise.resolve((id ? l.filter((x) => x.id === id) : [...l]).reverse());
  }
  conducoes(c: ContextoCoex, setor?: string) {
    return Promise.resolve(this.de(this.conducoesDe, c.hospital).filter((x) => !setor || x.setor === setor));
  }
  opcoesDosGrupos(_c: ContextoCoex, grupos: readonly string[]) {
    const estado = estadoAcessoSintetico();
    return Promise.resolve(
      grupos.flatMap((g) =>
        [...(estado.opcoesGrupo.get(g) ?? [])].map((opcao) => ({ grupo: g, opcao, titulo: null })),
      ),
    );
  }
  /** Os mesmos filtros e a mesma ordem da leitura do banco (lerChamados). */
  private filtrarChamados(c: ContextoCoex, f: FiltroChamados): ChamadoLidoBanco[] {
    const encerrado = (x: ChamadoLidoBanco) => ['resolvido', 'cancelado'].includes(x.situacao);
    const l = this.de(this.chamadosDe, c.hospital).filter(
      (x) =>
        (!f.id || x.id === f.id) &&
        (!f.desde ||
          x.abertoEm.toISOString().slice(0, 10) >= f.desde ||
          (f.ouAbertos === true && !encerrado(x))) &&
        (!f.severidade || x.severidade === f.severidade) &&
        (!f.situacao || x.situacao === f.situacao) &&
        (!f.setor || x.setor === f.setor) &&
        (!f.sistema || x.sistema === f.sistema),
    );
    const porId = (a: ChamadoLidoBanco, b: ChamadoLidoBanco) => Number(b.id) - Number(a.id);
    return l.sort(
      f.ordem === 'triagem'
        ? (a, b) =>
            Number(encerrado(a)) - Number(encerrado(b)) ||
            a.severidade.localeCompare(b.severidade) ||
            a.prazoResposta.getTime() - b.prazoResposta.getTime() ||
            porId(a, b)
        : porId,
    );
  }
  chamados(c: ContextoCoex, f: FiltroChamados = {}) {
    const pular = f.pular ?? 0;
    return Promise.resolve(this.filtrarChamados(c, f).slice(pular, pular + (f.limite ?? 500)));
  }
  contarChamados(c: ContextoCoex, f: FiltroChamados = {}) {
    return Promise.resolve(this.filtrarChamados(c, f).length);
  }
  chaves(c: ContextoCoex) {
    return this.config.chaves(c.rede, c.hospital);
  }
  itensLigar(c: ContextoCoex) {
    return Promise.resolve(this.de(this.ligarDe, c.hospital).map((x) => ({ ...x })));
  }
  /**
   * M43 (regras 4 e 5): os ativos sem grupo e os logins de painel das contas sintéticas (o mesmo estado que a tela de
   * usuários em memória muda: a troca de grupo e o bloqueio aparecem aqui na hora).
   */
  usuariosRevisao() {
    const estado = estadoAcessoSintetico();
    const r = [...estado.contas.entries()]
      .map(([login, c]) => ({
        login,
        grupo: c.grupo,
        status: 'T',
        bloqueado: (estado.bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false) ? 'T' : 'F',
      }))
      .filter(
        (u) =>
          u.grupo === 'PAINEIS' ||
          // As contas sintéticas sem grupo do legado (operadores de dev) não entram: só as do grupo "SEM GRUPO".
          (u.grupo === 'SEM GRUPO' && u.bloqueado !== 'T'),
      );
    return Promise.resolve(r.sort((a, b) => a.login.localeCompare(b.login)));
  }
  async contagemUsuariosFim() {
    const estado = estadoAcessoSintetico();
    const todos = [...estado.contas.entries()].map(([login, c]) => ({
      grupo: c.grupo,
      bloqueado: estado.bloqueio.get(login) ?? CONTAS_SINTETICAS[login]?.bloqueado ?? false,
    }));
    const ativos = todos.filter((u) => !u.bloqueado);
    return {
      total: todos.length,
      ativos: ativos.length,
      ativosSemGrupo: ativos.filter((u) => u.grupo === 'SEM GRUPO').length,
      ativosGrupoNulo: 0,
      paineisLivres: ativos.filter((u) => u.grupo === 'PAINEIS').length,
      paineisBloqueados: todos.filter((u) => u.grupo === 'PAINEIS' && u.bloqueado).length,
    };
  }
  gruposAtivos() {
    const estado = estadoAcessoSintetico();
    return Promise.resolve(
      [...estado.grupos.entries()]
        .filter(([, ativo]) => ativo)
        .map(([g]) => g)
        .sort(),
    );
  }
  /** M43: a competência sintética (dev/ci): fechada e enviada pelo novo em todos os convênios. */
  competenciaFim() {
    return Promise.resolve({
      competencia: '2026-12',
      conveniosComConta: 2,
      conveniosFechados: 2,
      fechadosPeloNovo: 2,
      lotes: 3,
      lotesPeloNovo: 3,
      ultimaGravacaoNovo: '2027-01-08',
    });
  }
  /** M43: sem coletor em memória (os dias ficam sem medida: falha fechada). */
  serieOutroSistema() {
    return Promise.resolve([]);
  }
  /**
   * M58 (F1): a tabela de conexões do outro sistema sintética (pessoas pelo dia da última conexão, relativas a hoje: 4
   * ontem, 7 três dias atrás, 12 dez dias atrás e 15 vinte dias atrás), as contas declaradas presentes (com escrita as
   * dos serviços do fornecedor), a plataforma da cópia (NONE, 3.0.14, ODS 12.0) e as 5 funções externas medidas.
   */
  leituraDesligamento(
    c: ContextoCoex,
    p: { desde: string; inicioJanela: string; excluidos: readonly string[]; comContas: boolean },
  ): Promise<LeituraDesligamento> {
    const hoje = this.parede().toISOString().slice(0, 10);
    const menos = (n: number) =>
      new Date(Date.parse(`${hoje}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
    const porDia = [
      { dia: menos(20), pessoas: 15 },
      { dia: menos(10), pessoas: 12 },
      { dia: menos(3), pessoas: 7 },
      { dia: menos(1), pessoas: 4 },
    ].filter((x) => x.dia >= p.desde);
    return Promise.resolve({
      sessoes: {
        porDia,
        distintosNaJanela: porDia.filter((x) => x.dia >= p.inicioJanela).reduce((s, x) => s + x.pessoas, 0),
        ultimoDia: menos(1),
      },
      contas: !p.comContas
        ? null
        : {
            declaradas: CONTAS_TECNICAS_DECLARADAS.map((x) => ({
              conta: x.prefixo ? `${x.conta}*` : x.conta,
              presente: true,
              escrita: x.destino === 'para-com-o-fornecedor' || x.conta === 'SGHBACKUP',
            })),
            naoDeclaradas: 0,
          },
      ...this.plataformaSintetica(),
      itens: this.de(this.desligDe, c.hospital).map((x) => ({ ...x })),
    });
  }
  plataformaBanco() {
    return Promise.resolve(this.plataformaSintetica());
  }
  versoesRegistro(c: ContextoCoex, tipo: string) {
    return Promise.resolve(
      this.de(this.registrosDe, c.hospital)
        .filter((x) => x.tipo === tipo)
        .sort((a, b) => b.versao - a.versao)
        .map((x) => ({
          versao: x.versao,
          conteudo: x.conteudo,
          motivo: x.motivo,
          gravadoPor: x.gravadoPor,
          gravadoEm: x.gravadoEm,
        })),
    );
  }
  /** M59 (F6): um catálogo sintético pequeno (a forma do banco, sem nome de pessoa). */
  catalogoRetrocompatibilidade() {
    return Promise.resolve({
      tabelas: ['TBPACIENTE', 'TBATENDIME', 'PRCONTEVOL', 'TBUSERS', 'SGH_TRILHA'],
      colunas: [
        { tabela: 'TBPACIENTE', coluna: 'ATIVO', classe: 'letra' as const },
        { tabela: 'TBATENDIME', coluna: 'URGENTE', classe: 'letra' as const },
        { tabela: 'TBATENDIME', coluna: 'DATAATEND', classe: 'data' as const },
        { tabela: 'TBATENDIME', coluna: 'HORAATEND', classe: 'hora' as const },
        { tabela: 'PRCONTEVOL', coluna: 'DATA', classe: 'data' as const },
        { tabela: 'PRCONTEVOL', coluna: 'HORA', classe: 'hora' as const },
      ],
      gatilhos: [
        { nome: 'TRG_TBPACIENTE_BI', tabela: 'TBPACIENTE', ativo: true },
        { nome: 'TRG_TBUSERS_AU', tabela: 'TBUSERS', ativo: true },
        { nome: 'TRG_TBATENDIME_BU', tabela: 'TBATENDIME', ativo: false },
      ],
      chaves: [
        { restricao: 'FK_ATEND_PAC', tabela: 'TBATENDIME', texto: false },
        { restricao: 'FK_EVOL_ATEND', tabela: 'PRCONTEVOL', texto: true },
      ],
    });
  }
  private plataformaSintetica(): Pick<LeituraDesligamento, 'plataforma' | 'funcoes'> {
    const dependentes: Record<string, number> = { LTRIM: 1, RTRIM: 2, STRLEN: 20, SUBSTR: 45, VLR_MED: 0 };
    return {
      plataforma: {
        charsetBanco: 'NONE',
        versaoMotor: '3.0.14',
        ods: '12.0',
        tamanhoPagina: 8192,
        dialeto: 3,
        colunasTexto: [
          { tipo: 'char', charsetId: 0, colunas: 3241 },
          { tipo: 'varchar', charsetId: 0, colunas: 11522 },
          { tipo: 'blob-texto', charsetId: 0, colunas: 548 },
        ],
        indicesComTexto: 1509,
      },
      funcoes: [
        ...FUNCOES_EXTERNAS_ESPERADAS.map((f) => ({
          nome: f.nome,
          modulo: f.modulo,
          entrada: f.entrada,
          dependentes: dependentes[f.nome] ?? 0,
        })),
        { nome: 'F_IDADE', modulo: null, entrada: null, dependentes: 3 },
      ],
    };
  }
  /**
   * M40 (campo 4): agregados sintéticos e determinísticos por dia (massa de dev/ci): duas unidades, a checagem só no
   * piloto (UTI), a higienização com uma solicitação que avança por dia e os registros com a parcela do novo.
   */
  acompanhamentoOnda2(_c: ContextoCoex, de: string, ate: string) {
    const dias: string[] = [];
    for (let t = Date.parse(`${de}T00:00:00Z`); t <= Date.parse(`${ate}T00:00:00Z`); t += 86_400_000)
      dias.push(new Date(t).toISOString().slice(0, 10));
    return Promise.resolve({
      checagem: dias.flatMap((dia, i) => [
        { dia, unidade: 'UTI', situacao: 'A', n: 10 + i },
        { dia, unidade: 'UTI', situacao: 'P', n: 30 - i },
        { dia, unidade: 'CLI', situacao: 'P', n: 50 },
      ]),
      higienizacao: dias.flatMap((dia) => [
        { dia, unidade: 'UTI', situacao: 1, comEtapaNoNovo: 1, n: 4 },
        { dia, unidade: 'CLI', situacao: 1, comEtapaNoNovo: 0, n: 3 },
      ]),
      registros: {
        totais: dias.flatMap((dia) => [
          { dia, tipo: 'evolucao' as const, n: 40 },
          { dia, tipo: 'prescricao' as const, n: 12 },
        ]),
        peloNovo: dias.flatMap((dia, i) => [
          { dia, tipo: 'evolucao' as const, n: i },
          { dia, tipo: 'prescricao' as const, n: Math.min(i, 12) },
        ]),
      },
    });
  }
  carga() {
    return Promise.resolve({
      conexoesPorSistema: [
        { sistema: 'novo', conexoes: 2 },
        { sistema: 'spdata-simulado', conexoes: 0 },
      ],
      transacoesLongas: 0,
      esperasPorTrava: 0,
      em: this.agora().toISOString(),
    });
  }

  private gravador(c: ContextoCoex): GravadorCoex {
    const h = c.hospital;
    return {
      gravarSetor: (s, u) => {
        const l = this.de(this.setoresDe, h);
        const i = l.findIndex((x) => x.codigo === s.codigo);
        const hoje = this.parede().toISOString().slice(0, 10);
        const antes = i >= 0 ? l[i]! : null;
        const datas = {
          ...(antes?.datas ?? {
            homologacao: null,
            treinamento: null,
            liberado: null,
            acompanhamento: null,
            migrado: null,
          }),
        };
        if (s.colunaData && antes?.situacao !== s.situacao) datas[s.colunaData] = hoje;
        const novo: SetorCoexLido = {
          codigo: s.codigo,
          nome: s.nome,
          onda: s.onda,
          situacao: s.situacao,
          chaveLiberacao: s.chaveLiberacao,
          conducao: s.conducao,
          aceiteCoordenador: s.aceiteCoordenador,
          datas,
          composicao: s.composicao ? s.composicao.map((x) => ({ ...x })) : (antes?.composicao ?? []),
        };
        void u;
        if (i >= 0) l[i] = novo;
        else l.push(novo);
        return Promise.resolve({ incluido: i < 0 });
      },
      publicarTrilha: (t, u) => {
        const l = this.de(this.trilhasDe, h);
        // Como no legado: o número de uma versão excluída (retrato 'hospital|papel|onda|versao') nunca volta.
        const prefixo = `${h}|${t.papel}|${t.onda}|`;
        const excluidas = this.de(this.retratosDe, h)
          .filter((r) => r.tabela === 'SGH_CFG_COEX_TRILHA' && r.chave.startsWith(prefixo))
          .map((r) => Number(r.chave.slice(prefixo.length)));
        const versao =
          [
            ...l.filter((x) => x.papel === t.papel && x.onda === t.onda).map((x) => x.versao),
            ...excluidas,
          ].reduce((m, v) => Math.max(m, v), 0) + 1;
        for (let i = 0; i < l.length; i++)
          if (l[i]!.papel === t.papel && l[i]!.onda === t.onda && l[i]!.situacao === 'vigente')
            l[i] = { ...l[i]!, situacao: 'desatualizada' };
        l.push({
          ...t,
          tarefas: [...t.tarefas],
          versao,
          situacao: 'vigente',
          publicadaPor: u,
          publicadaEm: this.agora().toISOString(),
        });
        return Promise.resolve({ versao });
      },
      registrarConclusoes: (x, u) => {
        const l = this.de(this.conclusoesDe, h);
        for (const p of x.pessoas) {
          if (p.login === u) throw new Error('Ninguém registra a própria conclusão.');
          l.push({
            id: this.proximo(),
            login: p.login,
            papel: x.papel,
            onda: x.onda,
            versao: x.versao,
            turma: x.turma,
            turno: x.turno,
            concluidoEm: x.concluidoEm,
            resultado: x.resultado,
            registradoPor: u,
          });
        }
        return Promise.resolve({ registradas: x.pessoas.length });
      },
      abrirChamado: (x, alertar) => {
        const id = this.proximo();
        this.de(this.chamadosDe, h).push({
          id,
          sistema: x.sistema,
          severidade: x.severidade,
          nivel: 'N1',
          situacao: 'aberto',
          tela: x.tela,
          versao: x.versao,
          traceId: x.traceId,
          setor: x.setor,
          ocorridoEm: x.ocorridoEm,
          prazoResposta: x.prazoResposta,
          prazoSolucao: x.prazoSolucao,
          comandante: null,
          dadoPessoal: x.dadoPessoal,
          encarregadoAvisado: alertar.encarregado,
          descricao: x.descricao,
          contorno: null,
          abertoPor: x.abertoPor,
          abertoEm: this.parede(),
          respondidoEm: null,
          atualizadoEm: null,
          resolvidoEm: null,
        });
        return Promise.resolve(id);
      },
      triarChamado: (id, t) => {
        const l = this.de(this.chamadosDe, h);
        const i = l.findIndex((x) => x.id === id && x.situacao !== 'resolvido' && x.situacao !== 'cancelado');
        if (i < 0) return Promise.resolve(0);
        const agora = this.parede();
        l[i] = {
          ...l[i]!,
          severidade: t.severidade,
          situacao: t.situacao,
          nivel: t.nivel,
          comandante: t.comandante,
          contorno: t.contorno ?? l[i]!.contorno,
          prazoResposta: t.prazoResposta,
          prazoSolucao: t.prazoSolucao,
          respondidoEm: l[i]!.respondidoEm ?? agora,
          atualizadoEm: agora,
          resolvidoEm: t.situacao === 'resolvido' ? agora : l[i]!.resolvidoEm,
        };
        return Promise.resolve(1);
      },
      gravarUsoDia: (linhas) => {
        const l = this.de(this.usoDe, h);
        for (const x of linhas) {
          const i = l.findIndex((u) => u.dia === x.dia && u.setor === x.setor && u.operacao === x.operacao);
          const antes = i >= 0 ? l[i] : undefined;
          // A disputa é incremento somado ao gravado do dia (como o banco: a partida da API não apaga o contado).
          const v: UsoDiaLido = {
            dia: x.dia,
            setor: x.setor,
            operacao: x.operacao,
            noNovo: x.noNovo,
            noLegado: x.noLegado,
            colisoes: (antes?.colisoes ?? 0) + (x.colisoes ?? 0),
            esperasTrava: (antes?.esperasTrava ?? 0) + (x.esperasTrava ?? 0),
            recusasOcupado: (antes?.recusasOcupado ?? 0) + (x.recusasOcupado ?? 0),
            p50Ms: x.p50Ms ?? null,
            p95Ms: x.p95Ms ?? null,
          };
          if (i >= 0) l[i] = v;
          else l.push(v);
        }
        return Promise.resolve({ gravadas: linhas.length });
      },
      gravarItemDesligamento: (i, usuario) => {
        const l = this.de(this.desligDe, h);
        const registradoEm = this.agora().toISOString();
        const k = l.findIndex((x) => x.item === i.item);
        const antes = k >= 0 ? l[k] : undefined;
        const anterior = antes
          ? {
              situacao: antes.situacao,
              contingencia: antes.contingencia,
              papelResponsavel: antes.papelResponsavel,
              evidencia: antes.evidencia,
            }
          : null;
        const linha = { ...i, alteradoPor: usuario.slice(0, 31), registradoEm };
        if (k >= 0) l[k] = linha;
        else l.push(linha);
        return Promise.resolve({ registradoEm, incluido: k < 0, anterior });
      },
      gravarItensLigar: (setor, itens, usuario) => {
        const l = this.de(this.ligarDe, h);
        const em = this.agora().toISOString();
        for (const x of itens) {
          if (['operacoes-conferidas', 'pentest-sem-critico'].includes(x.item))
            throw new Error('Item calculado: não se grava.');
          const v: ItemLigarLido = {
            setor,
            item: x.item,
            situacao: x.situacao,
            evidencia: x.evidencia,
            em: x.em,
            alteradoPor: usuario,
            alteradoEm: em,
          };
          const i = l.findIndex((y) => y.setor === setor && y.item === x.item);
          if (i >= 0) l[i] = v;
          else l.push(v);
        }
        return Promise.resolve({ gravados: itens.length });
      },
      voltarItemLigarPendente: (setor, item, usuario) => {
        const l = this.de(this.ligarDe, h);
        const i = l.findIndex((y) => y.setor === setor && y.item === item);
        const a = l[i];
        if (!a || a.situacao === 'pendente') return Promise.resolve(null);
        l[i] = {
          ...a,
          situacao: 'pendente',
          evidencia: '',
          em: null,
          alteradoPor: usuario,
          alteradoEm: this.agora().toISOString(),
        };
        return Promise.resolve({
          situacao: a.situacao,
          evidencia: a.evidencia,
          em: a.em,
          alteradoPor: a.alteradoPor,
        });
      },
      voltarItemDesligamentoPendente: (item, usuario) => {
        const l = this.de(this.desligDe, h);
        const i = l.findIndex((y) => y.item === item);
        const a = l[i];
        if (!a || a.situacao === 'pendente') return Promise.resolve(null);
        l[i] = {
          ...a,
          situacao: 'pendente',
          papelResponsavel: '',
          evidencia: '',
          alteradoPor: usuario.slice(0, 31),
          registradoEm: this.agora().toISOString(),
        };
        return Promise.resolve({
          situacao: a.situacao,
          contingencia: a.contingencia,
          papelResponsavel: a.papelResponsavel,
          evidencia: a.evidencia,
          alteradoPor: a.alteradoPor,
        });
      },
      lerConclusaoParaEstorno: (id) => {
        const x = this.de(this.conclusoesDe, h).find((y) => y.id === id);
        if (!x) return Promise.resolve(null);
        const est = this.de(this.estornosDe, h).find((y) => y.id === id);
        return Promise.resolve({
          id: x.id,
          login: x.login,
          papel: x.papel,
          onda: x.onda,
          versao: x.versao,
          turma: x.turma,
          concluidoEm: x.concluidoEm,
          resultado: x.resultado,
          registradoPor: x.registradoPor,
          estornadaEm: est?.em ?? null,
        });
      },
      estornarConclusao: (id, motivo, usuario) => {
        const l = this.de(this.estornosDe, h);
        if (l.some((y) => y.id === id))
          throw new Error('SGH_CFG_COEX_TREINO_ESTORNO: estorno repetido (PK).');
        l.push({ id, motivo, por: usuario, em: this.agora().toISOString() });
        return Promise.resolve();
      },
      lerVersaoTrilha: (v) => {
        const t = this.de(this.trilhasDe, h).find(
          (y) => y.papel === v.papel && y.onda === v.onda && y.versao === v.versao,
        );
        return Promise.resolve(
          t ? { papel: t.papel, onda: t.onda, versao: t.versao, nome: t.nome, situacao: t.situacao } : null,
        );
      },
      contarVinculosTrilha: (v) => {
        // Como no banco: as conclusões estornadas continuam vínculo da versão.
        const cs = this.de(this.conclusoesDe, h).filter(
          (y) => y.papel === v.papel && y.onda === v.onda && y.versao === v.versao,
        );
        const turmas = new Set(cs.map((y) => y.turma)).size;
        return Promise.resolve([
          ...(turmas > 0 ? [{ grupo: 'turmas', quantidade: turmas, agrupamento: true as const }] : []),
          ...(cs.length > 0 ? [{ grupo: 'conclusões de treinamento', quantidade: cs.length }] : []),
        ]);
      },
      retratarVersaoTrilha: (v, quem) => {
        const t = this.de(this.trilhasDe, h).find(
          (y) => y.papel === v.papel && y.onda === v.onda && y.versao === v.versao,
        );
        if (!t) throw new Error('SGH_CFG_COEX_TRILHA: versão sem linha para o retrato.');
        this.de(this.retratosDe, h).push({
          tabela: 'SGH_CFG_COEX_TRILHA',
          chave: `${h}|${v.papel}|${v.onda}|${v.versao}`,
          linha: { ...t, tarefas: [...t.tarefas] },
          motivo: quem.motivo,
        });
        return Promise.resolve();
      },
      retirarVersaoTrilha: (v, modo) => {
        const l = this.de(this.trilhasDe, h);
        const i = l.findIndex((y) => y.papel === v.papel && y.onda === v.onda && y.versao === v.versao);
        if (i < 0) throw new Error('SGH_CFG_COEX_TRILHA: a versão não foi retirada.');
        if (modo === 'excluir') l.splice(i, 1);
        else l[i] = { ...l[i]!, situacao: 'retirada' };
        if (!v.eraVigente) return Promise.resolve({ promovida: null });
        const anteriores = l
          .filter((y) => y.papel === v.papel && y.onda === v.onda && y.situacao === 'desatualizada')
          .sort((a, b) => b.versao - a.versao);
        const p = anteriores[0];
        if (!p) return Promise.resolve({ promovida: null });
        const k = l.indexOf(p);
        l[k] = { ...p, situacao: 'vigente' };
        return Promise.resolve({ promovida: p.versao });
      },
      registrarEvento: (ev) => {
        this.de(this.eventosDe, h).push({ ...ev, em: this.agora().toISOString() });
        return Promise.resolve();
      },
      gravarVersaoRegistro: (tipo, conteudo, motivo, usuario) => {
        const l = this.de(this.registrosDe, h);
        const versao = Math.max(0, ...l.filter((x) => x.tipo === tipo).map((x) => x.versao)) + 1;
        l.push({
          tipo,
          versao,
          conteudo:
            conteudo === null ? null : (JSON.parse(JSON.stringify(conteudo)) as Record<string, unknown>),
          motivo,
          gravadoPor: usuario,
          gravadoEm: this.agora().toISOString(),
        });
        return Promise.resolve(versao);
      },
    };
  }

  async gravarSgh<T>(
    c: ContextoCoex,
    trilha: LinhaTrilha | ((r: T) => LinhaTrilha),
    fn: (g: GravadorCoex) => Promise<T>,
  ): Promise<T> {
    const r = await fn(this.gravador(c));
    const t = typeof trilha === 'function' ? trilha(r) : trilha;
    await this.trilha.registrar({
      evento: t.evento,
      rede: t.rede,
      hospital: t.hospital,
      usuario: t.usuario,
      estacao: t.estacao ?? 'memoria',
      recurso: t.recurso,
      resultado: 'sucesso',
      correlacao: t.correlacao,
      ...(t.tabelaAlvo ? { tabelaAlvo: t.tabelaAlvo } : {}),
      ...(t.idAlvo ? { idAlvo: t.idAlvo } : {}),
      ...(t.chaveNaturalAlvo ? { chaveNaturalAlvo: t.chaveNaturalAlvo } : {}),
    });
    return r;
  }

  async aplicarLote(
    c: ContextoCoex,
    p: Parameters<PortaCoexistencia['aplicarLote']>[1],
    trilha: Parameters<PortaCoexistencia['aplicarLote']>[2],
  ) {
    const chaves: { tipo: string; chave: string; loteLiberacao: string; alteradas: number }[] = [];
    for (const k of p.chaves) {
      const r = await this.config.aplicarLote(
        c.rede,
        {
          hospital: c.hospital,
          tipo: k.tipo,
          chave: k.chave,
          planejar: (estado) => {
            p.conferir?.(k, estado);
            return p.planejar(k, estado);
          },
          justificativa: p.justificativa,
          autor: p.autor,
          referenciaAutorizacao: p.autorizacao,
        },
        trilha,
      );
      chaves.push({ tipo: k.tipo, chave: k.chave, loteLiberacao: r.lote, alteradas: r.alteradas });
    }
    const id = this.proximo();
    this.de(this.lotesDe, c.hospital).push({
      id,
      setor: p.setor,
      alvoTipo: p.alvoTipo,
      alvo: p.alvo,
      chaves: chaves.map((x) => ({
        tipo: x.tipo as 'operacao' | 'recurso',
        chave: x.chave,
        loteLiberacao: x.loteLiberacao,
      })),
      incluidos: p.incluidos.length,
      fora: p.fora.length,
      conducao: p.conducao === true,
      situacao: 'aplicado',
      aplicadoPor: p.autor,
      aplicadoEm: this.agora().toISOString(),
      recolhidoEm: null,
    });
    return { id, chaves };
  }

  async recolherLote(
    c: ContextoCoex,
    p: Parameters<PortaCoexistencia['recolherLote']>[1],
    trilha: Parameters<PortaCoexistencia['recolherLote']>[2],
  ) {
    const l = this.de(this.lotesDe, c.hospital);
    const i = l.findIndex((x) => x.id === p.id && x.situacao === 'aplicado');
    if (i < 0) return { recolhido: false, alteradas: 0 };
    let alteradas = 0;
    for (const k of p.chaves) {
      if (!k.loteLiberacao) continue;
      const linhas = await this.config.lote(c.rede, c.hospital, k.loteLiberacao);
      if (linhas.length === 0) continue;
      const r = await this.config.aplicarLote(
        c.rede,
        {
          hospital: c.hospital,
          tipo: k.tipo,
          chave: k.chave,
          planejar: () =>
            linhas.map((x) => ({ escopo: x.escopo, valor: x.valor, ligada: x.ligadaAntes, antes: x.ligada })),
          justificativa: p.justificativa,
          autor: p.autor,
        },
        trilha,
      );
      alteradas += r.alteradas;
    }
    l[i] = { ...l[i]!, situacao: 'recolhido', recolhidoEm: this.agora().toISOString() };
    return { recolhido: true, alteradas };
  }

  registrarConducaoMemoria(
    c: ContextoCoex,
    acao: 'retirar' | 'devolver',
    p: {
      setor: string;
      grupo: string;
      opcoes: readonly number[];
      autorizacao: string;
      lote?: string;
      usuario: string;
    },
  ): void {
    const l = this.de(this.conducoesDe, c.hospital);
    for (const opcao of p.opcoes) {
      if (acao === 'retirar')
        l.push({
          id: this.proximo(),
          lote: p.lote ?? null,
          setor: p.setor,
          grupo: p.grupo,
          opcao,
          situacao: 'retirada',
          autorizacao: p.autorizacao,
          retiradaPor: p.usuario,
          retiradaEm: this.agora().toISOString(),
        });
      else {
        const i = l.findIndex((x) => x.grupo === p.grupo && x.opcao === opcao && x.situacao === 'retirada');
        if (i >= 0) l[i] = { ...l[i]!, situacao: 'devolvida' };
      }
    }
  }
}
