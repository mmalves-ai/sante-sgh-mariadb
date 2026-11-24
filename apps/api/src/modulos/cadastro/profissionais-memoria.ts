// D-PROF-39: o corpo clínico SINTÉTICO da sessão de dev/ci (E2E) com as regras de negócio da gravação do profissional:
// Zod dos contratos, CPF e registro repetidos, sombra recusada, versão do controle otimista, nada mudado. Nada vai à
// cópia; nenhum nome aqui é de pessoa real (marca "SINTETICO"). Nenhum dado bancário nem de repasse (regra 11).
import {
  esquemaAlterarProfissional,
  esquemaAlterarRegistroProfissional,
  esquemaCadastrarProfissional,
  esquemaCredenciamentoProfissional,
  esquemaEspecialidadeProfissional,
  esquemaIncluirRegistroProfissional,
  esquemaExcluirProfissional,
  esquemaExcluirRegistroProfissional,
  esquemaLotacaoProfissional,
  esquemaSituacaoProfissional,
  esquemaVincularLoginProfissional,
  mensagemOutroLoginNoProfissional,
  mensagemOutroLoginNoRegistro,
  outroLoginDoProfissional,
  outroLoginNoRegistro,
  RECUSA_OUTRO_LOGIN_NO_PROFISSIONAL,
  type RegistroNovoProfissional,
} from '@sgh/contratos';
import { erroConflitoVersao, erroEntradaInvalida, recusa } from '@sgh/nucleo';
import { lerVersaoColunas, versaoDasColunas } from './memoria-versao.js';
import type {
  DadosProfissional,
  EventoVinculoProfissional,
  FichaProfissionalCadastro,
  LoginCandidato,
  OpcoesEdicaoProfissional,
  ProfissionalCadastro,
} from './tipos.js';
import type { z } from 'zod';

const M = 'SINTETICO';

/** Colunas da versão opaca da linha sintética do profissional e do registro (só a memória de dev/ci). */
const COLUNAS_VERSAO_PROFISSIONAL = [
  'NOME',
  'APELIDO',
  'SEXO',
  'NASC',
  'NOME_MAE',
  'EMAIL',
  'CELULAR',
] as const;
const COLUNAS_VERSAO_REGISTRO = ['ATIVO', 'CONSELHO', 'SIGLA'] as const;
/** Coluna da linha sintética → campo da tela (o aviso de colisão cita o campo). */
const CAMPO_DA_COLUNA_PROFISSIONAL: Readonly<Record<string, string>> = {
  NOME: 'nome',
  APELIDO: 'nomeSocial',
  SEXO: 'sexo',
  NASC: 'nascimento',
  NOME_MAE: 'nomeMae',
  EMAIL: 'email',
  CELULAR: 'celular',
  ATIVO: 'ativo',
  CONSELHO: 'conselho',
  SIGLA: 'sigla',
};

export const OPERACOES_PROFISSIONAL_TELA = [
  'cadastro.cadastrarProfissional',
  'cadastro.alterarProfissional',
  'cadastro.incluirRegistroProfissional',
  'cadastro.alterarRegistroProfissional',
  'cadastro.definirEspecialidadeProfissional',
  'cadastro.lotarProfissional',
  'cadastro.credenciarProfissional',
  'cadastro.vincularLoginProfissional',
  'cadastro.inativarProfissional',
  'cadastro.reativarProfissional',
  'cadastro.excluirProfissional',
  'cadastro.excluirRegistroProfissional',
] as const;
/** As que pedem a senha de novo (receita crítica no executor). */
export const OPERACOES_PROFISSIONAL_CRITICAS: ReadonlySet<OperacaoProfissionalTela> = new Set([
  'cadastro.vincularLoginProfissional',
  'cadastro.excluirProfissional',
  'cadastro.excluirRegistroProfissional',
]);
export type OperacaoProfissionalTela = (typeof OPERACOES_PROFISSIONAL_TELA)[number];

interface RegistroMem {
  id: number;
  conselho: string;
  siglaId: number | null;
  numero: number;
  uf: string;
  cboId: number;
  ativo: boolean;
}
export interface ProfissionalMem {
  id: number;
  cpf: string;
  linha: Record<string, unknown>;
  situacao: string;
  registros: RegistroMem[];
  especialidades: { registro: number; codigo: number; ativo: boolean }[];
  lotacao: {
    registro: number;
    unidade: number;
    horasAmbulatorio: number;
    horasHospital: number;
    horasOutros: number;
    ativo: boolean;
  }[];
  credenciamentos: { registro: number; convenio: number }[];
}

const CBOS: Readonly<Record<number, { cod: string; descricao: string }>> = {
  1: { cod: '225125', descricao: 'MÉDICO CLÍNICO' },
  2: { cod: '225250', descricao: 'MÉDICO GINECOLOGISTA' },
  3: { cod: '223208', descricao: 'CIRURGIÃO-DENTISTA' },
  4: { cod: '223505', descricao: 'ENFERMEIRO' },
  5: { cod: '225170', descricao: 'MÉDICO GENERALISTA' },
};
const SIGLAS = [
  { valor: 1, rotulo: 'ENF · Enfermeiro', conselho: 'COREN' },
  { valor: 2, rotulo: 'TEC · Técnico de Enfermagem', conselho: 'COREN' },
  { valor: 3, rotulo: 'P · Registro Provisório', conselho: 'CRM' },
];
const CONSELHOS = ['CRM', 'COREN', 'CRO', 'CRF', 'CREFITO'];
const ESPECIALIDADES: Readonly<Record<number, string>> = {
  1: `CLÍNICA MÉDICA ${M}`,
  2: `CARDIOLOGIA ${M}`,
  3: `PEDIATRIA ${M}`,
};
const UNIDADES: Readonly<Record<number, string>> = { 1: `UNIDADE ${M}`, 2: `AMBULATÓRIO ${M}` };
const CONVENIOS: Readonly<Record<number, string>> = { 10: `CONVENIO ${M}`, 11: `PLANO ${M}` };
const SENTINELA = '1899-12-30T00:00:00.000Z';

function linha(nome: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NOME: nome,
    APELIDO: '',
    SEXO: 'F',
    NASC: new Date('1980-01-01T00:00:00Z'),
    NOME_MAE: '',
    EMAIL: '',
    CELULAR: ' ',
    ...extra,
  };
}

function iniciais(): ProfissionalMem[] {
  const p = (
    id: number,
    nome: string,
    situacao: string,
    registros: RegistroMem[],
    cpf: string,
  ): ProfissionalMem => ({
    id,
    cpf,
    linha: linha(nome),
    situacao,
    registros,
    especialidades: registros.map((r, i) => ({ registro: r.id, codigo: (i % 3) + 1, ativo: true })),
    lotacao: registros.map((r) => ({
      registro: r.id,
      unidade: 1,
      horasAmbulatorio: 20,
      horasHospital: 10,
      horasOutros: 0,
      ativo: true,
    })),
    credenciamentos: registros[0] ? [{ registro: registros[0].id, convenio: 10 }] : [],
  });
  const r = (id: number, conselho: string, numero: number, uf: string, cboId: number, ativo = true) => ({
    id,
    conselho,
    siglaId: null,
    numero,
    uf,
    cboId,
    ativo,
  });
  return [
    p(3, `ANA MÉDICA ${M}`, 'O', [r(10, 'CRM', 11111, 'MG', 1)], '90000000001'),
    p(
      4,
      `BRUNO DOIS CONSELHOS ${M}`,
      'O',
      [r(11, 'CRM', 22222, 'MG', 2), r(12, 'CRO', 3333, 'MG', 3)],
      '90000000002',
    ),
    p(5, `CARLA ENFERMEIRA ${M}`, 'F', [{ ...r(13, 'COREN', 44444, 'MG', 4), siglaId: 1 }], '90000000003'),
    p(6, `DANIEL INATIVO ${M}`, 'E', [r(14, 'CRM', 55555, 'SP', 1, false)], '90000000004'),
    // Login único (pergunta do dono, 18/11/2026: "por que tem 3 logins?"): o mesmo CRM em três ocupações (CBOs), um
    // login só; e o dado herdado com dois logins em ocupações diferentes (a tela avisa e oferece desligar o extra).
    p(
      7,
      `EDUARDO TRÊS OCUPAÇÕES ${M}`,
      'O',
      [r(15, 'CRM', 66666, 'MG', 1), r(16, 'CRM', 66666, 'MG', 2), r(17, 'CRM', 66666, 'MG', 5)],
      '90000000005',
    ),
    p(
      8,
      `FERNANDA DOIS LOGINS ${M}`,
      'O',
      [r(18, 'CRM', 77777, 'MG', 1), r(19, 'CRM', 77777, 'MG', 2)],
      '90000000006',
    ),
  ];
}

function analisar<T>(esquema: z.ZodType<T>, bruta: unknown): T {
  const r = esquema.safeParse(bruta);
  if (!r.success) throw erroEntradaInvalida([...new Set(r.error.issues.map((i) => i.path.join('.')))]);
  return r.data;
}

const comparavel = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v).trimEnd();

export function fraseVinculos(
  v: readonly { grupo: string; quantidade: number }[],
  oQue: string,
  saida: string,
): string {
  const total = v.reduce((s, x) => s + x.quantidade, 0);
  const lista = v.map((x) => `${x.grupo}: ${x.quantidade}`).join('; ');
  return `${oQue} tem ${total} ${total === 1 ? 'vínculo' : 'vínculos'} no sistema (${lista}). ${saida}`;
}

/** O corpo clínico sintético de um estabelecimento. */
export class ProfissionaisMemoria {
  readonly profissionais: ProfissionalMem[] = iniciais();
  private gerador = 9000;
  /**
   * Registro → login ligado (o papel Operador de sistema), o vínculo da conta com o registro. X-01: o profissional 3
   * (ANA) é o SINT.MEDICO, conta da sessão sintética; a ficha do usuário em memória lê ESTE mapa (profissionalDoLogin).
   */
  private readonly loginDoRegistro = new Map<number, string>([
    [10, 'SINT.MEDICO'],
    [11, 'SINT.PROF4'],
    [13, 'SINT.PROF5'],
    [15, 'SINT.PROF6'],
    [18, 'SINT.PROF7'],
    [19, 'SINT.PROF8'],
  ]);
  /**
   * Logins sintéticos com o papel Operador de sistema (SINT.SEMPAPEL não tem o papel). SINT.MEDICO e SINT.SAME são
   * contas da sessão sintética (Usuários e Acessos em memória): o atalho "Profissional vinculado" faz a ida e volta.
   */
  private readonly candidatos = [
    ['SINT.MEDICO', `ANA MÉDICA ${M}`],
    ['SINT.SAME', `USUÁRIO DO SAME ${M}`],
    ['SINT.PROF4', `BRUNO DOIS CONSELHOS ${M}`],
    ['SINT.PROF5', `CARLA ENFERMEIRA ${M}`],
    ['SINT.PROF6', `EDUARDO TRÊS OCUPAÇÕES ${M}`],
    ['SINT.PROF7', `FERNANDA DOIS LOGINS ${M}`],
    ['SINT.PROF8', `FERNANDA SEGUNDO LOGIN ${M}`],
    ['SINT.LIVRE1', `USUÁRIO LIVRE UM ${M}`],
    ['SINT.LIVRE2', `USUÁRIO LIVRE DOIS ${M}`],
  ] as const;
  /** Atos sintéticos por registro (atendimentos): o que impede a exclusão. */
  private readonly atos = new Map<number, number>([
    [10, 8],
    [11, 3],
    [14, 2],
  ]);
  private readonly eventos = new Map<number, EventoVinculoProfissional[]>();
  /** Retratos das exclusões (SGH_HIST_EXCLUSAO). */
  readonly retratos: { tabela: string; chave: string; motivo: string }[] = [];
  private agora = () => new Date().toISOString();

  logins(): LoginCandidato[] {
    return this.candidatos.map(([login, nome]) => {
      const reg = [...this.loginDoRegistro.entries()].find(([, l]) => l === login)?.[0];
      const p =
        reg === undefined ? undefined : this.profissionais.find((x) => x.registros.some((r) => r.id === reg));
      return { login, nome, profissional: p?.id ?? null };
    });
  }

  /** O profissional ligado ao login (primeiro registro, na ordem das ligações), como lerFichaUsuario no legado. */
  profissionalDoLogin(login: string): { id: number; nome: string } | null {
    const reg = [...this.loginDoRegistro.entries()].find(([, l]) => l === login)?.[0];
    if (reg === undefined) return null;
    const p = this.profissionais.find((x) => x.registros.some((r) => r.id === reg));
    return p ? { id: p.id, nome: String(p.linha['NOME'] ?? '').trim() } : null;
  }

  loginsPorRegistro(id: number): { registro: number; login: string }[] {
    const p = this.profissionais.find((x) => x.id === id);
    return (p?.registros ?? [])
      .filter((r) => this.loginDoRegistro.has(r.id))
      .map((r) => ({ registro: r.id, login: this.loginDoRegistro.get(r.id)! }));
  }

  historico(id: number): EventoVinculoProfissional[] {
    return [...(this.eventos.get(id) ?? [])];
  }

  /** Os vínculos (por grupo de produto) do profissional ou do registro, como o mapa de dependências. */
  vinculos(profissional: number, registro?: number): { grupo: string; quantidade: number }[] {
    const p = this.profissionais.find((x) => x.id === profissional);
    if (!p) return [];
    const regs = registro === undefined ? p.registros.map((r) => r.id) : [registro];
    const atos = regs.reduce((s, r) => s + (this.atos.get(r) ?? 0), 0);
    const login = regs.filter((r) => this.loginDoRegistro.has(r)).length;
    const historico = (this.eventos.get(profissional) ?? []).filter(
      (e) => e.evento.startsWith('login-') && (registro === undefined || e.registro === registro),
    ).length;
    return [
      ...(atos > 0 ? [{ grupo: 'Atendimentos', quantidade: atos }] : []),
      ...(login > 0 ? [{ grupo: 'Login do sistema', quantidade: login }] : []),
      ...(historico > 0 ? [{ grupo: 'Histórico do login do sistema', quantidade: historico }] : []),
    ];
  }

  private evento(
    profissional: number,
    e: Omit<EventoVinculoProfissional, 'usuario' | 'em'>,
    usuario: string,
  ): void {
    const l = this.eventos.get(profissional) ?? [];
    l.unshift({ ...e, usuario, em: this.agora() });
    this.eventos.set(profissional, l);
  }

  lidos(ids?: readonly number[]): ProfissionalCadastro[] {
    return this.profissionais
      .filter((p) => !ids || ids.includes(p.id))
      .map((p) => ({
        id: p.id,
        nome: String(p.linha['NOME']),
        nomeSocial: String(p.linha['APELIDO'] ?? '').trim() || null,
        situacao: p.situacao,
        registros: p.registros.map((r) => this.registroLido(p.id, r)),
      }));
  }

  private registroLido(profissional: number, r: RegistroMem) {
    const cbo = CBOS[r.cboId];
    const sigla = SIGLAS.find((s) => s.valor === r.siglaId);
    return {
      id: r.id,
      profissional,
      conselho: r.conselho,
      sigla: sigla ? sigla.rotulo.split(' · ')[0]! : null,
      numero: r.numero,
      uf: r.uf,
      cbo: cbo?.cod ?? null,
      cboDescricao: cbo?.descricao ?? null,
      ativo: r.ativo,
      siglaId: r.siglaId,
      versao: versaoDasColunas(COLUNAS_VERSAO_REGISTRO, this.linhaRegistro(r)),
    };
  }

  private linhaRegistro(r: RegistroMem): Record<string, unknown> {
    return { ATIVO: r.ativo, CONSELHO: r.conselho, SIGLA: r.siglaId };
  }

  ficha(id: number): FichaProfissionalCadastro | null {
    const [l] = this.lidos([id]);
    const p = this.profissionais.find((x) => x.id === id);
    if (!l || !p) return null;
    return {
      ...l,
      especialidades: p.especialidades.map((e) => ({
        ...e,
        nome: ESPECIALIDADES[e.codigo] ?? String(e.codigo),
      })),
      lotacao: p.lotacao.map((x) => ({ ...x, nome: UNIDADES[x.unidade] ?? null })),
      credenciamentos: p.credenciamentos.map((c) => ({ ...c, nome: CONVENIOS[c.convenio] ?? null })),
      logins: this.loginsPorRegistro(id).map((x) => ({ login: x.login, origem: 'papel' as const })),
    };
  }

  dados(id: number): DadosProfissional | null {
    const p = this.profissionais.find((x) => x.id === id);
    if (!p) return null;
    const l = p.linha;
    const t = (v: unknown) => String(v ?? '').trim() || null;
    const nasc = l['NASC'] instanceof Date ? (l['NASC'] as Date).toISOString() : null;
    return {
      sexo: t(l['SEXO']),
      nascimento: nasc && nasc !== SENTINELA ? nasc.slice(0, 10) : null,
      nomeMae: t(l['NOME_MAE']),
      email: t(l['EMAIL']),
      celular: t(l['CELULAR']),
      versao: versaoDasColunas(COLUNAS_VERSAO_PROFISSIONAL, l),
    };
  }

  opcoes(): OpcoesEdicaoProfissional {
    return {
      conselhos: CONSELHOS.map((c) => ({ valor: c, rotulo: c })),
      siglas: [...SIGLAS],
      cbos: Object.entries(CBOS).map(([id, c]) => ({
        valor: Number(id),
        rotulo: `${c.cod} · ${c.descricao}`,
      })),
      especialidades: Object.entries(ESPECIALIDADES).map(([k, v]) => ({ valor: Number(k), rotulo: v })),
      unidades: Object.entries(UNIDADES).map(([k, v]) => ({ valor: Number(k), rotulo: v })),
      convenios: Object.entries(CONVENIOS).map(([k, v]) => ({ valor: Number(k), rotulo: v })),
      ufs: ['MG', 'RJ', 'SP'],
    };
  }

  private registroReal(id: number): { p: ProfissionalMem; r: RegistroMem } {
    for (const p of this.profissionais) {
      const r = p.registros.find((x) => x.id === id);
      if (r) return { p, r };
    }
    throw recusa('registro-inexistente', 'Registro não encontrado.');
  }

  private conferirRegistroNovo(r: RegistroNovoProfissional, profissional: number | null): void {
    if (!CBOS[r.cbo])
      throw recusa('cbo-inexistente', 'Ocupação (CBO) não encontrada.', { campos: ['registro.cbo'] });
    if (!CONSELHOS.includes(r.conselho))
      throw recusa('conselho-inexistente', 'Conselho não encontrado no cadastro de conselhos.', {
        campos: ['conselho'],
      });
    if (r.sigla !== undefined && SIGLAS.find((s) => s.valor === r.sigla)?.conselho !== r.conselho)
      throw recusa('sigla-incompativel', 'A sigla não pertence a este conselho.', { campos: ['sigla'] });
    for (const p of this.profissionais)
      for (const x of p.registros)
        if (
          x.numero === r.numero &&
          x.uf === r.uf &&
          x.conselho === r.conselho &&
          x.ativo &&
          p.id !== profissional
        )
          throw recusa(
            'registro-repetido',
            'Este número de conselho e UF já está no cadastro de outro profissional.',
            {
              campos: ['registro.numero'],
            },
          );
    for (const c of r.convenios)
      if (!CONVENIOS[c])
        throw recusa('convenio-inativo', 'Só convênio ativo recebe credenciamento.', {
          campos: ['registro.convenios'],
        });
  }

  /** O mesmo conselho, número e UF não fica ativo em dois profissionais (como conferirRegistroUnico do executor). */
  private conferirUnico(profissional: number, r: RegistroMem, conselho: string): void {
    for (const o of this.profissionais)
      if (
        o.id !== profissional &&
        o.registros.some((x) => x.ativo && x.numero === r.numero && x.uf === r.uf && x.conselho === conselho)
      )
        throw recusa(
          'registro-repetido',
          `O registro ${conselho} ${r.numero}/${r.uf} está ativo no cadastro de outro profissional.`,
        );
  }

  private novoRegistro(p: ProfissionalMem, r: RegistroNovoProfissional): number {
    if (p.registros.some((x) => x.cboId === r.cbo && x.uf === r.uf && x.numero === r.numero))
      throw recusa('registro-repetido', 'O profissional já tem este registro com esta ocupação.', {
        campos: ['registro.numero'],
      });
    const id = ++this.gerador;
    p.registros.push({
      id,
      conselho: r.conselho,
      siglaId: r.sigla ?? null,
      numero: r.numero,
      uf: r.uf,
      cboId: r.cbo,
      ativo: true,
    });
    for (const c of r.convenios) p.credenciamentos.push({ registro: id, convenio: c });
    return id;
  }

  /** As mesmas regras das receitas; devolve o resultado como o executor e o profissional para reindexar. */
  gravar(
    op: OperacaoProfissionalTela,
    bruta: unknown,
    usuario = 'SINT.OPERADOR',
  ): { resultado: Record<string, number>; profissional: ProfissionalMem | null } {
    switch (op) {
      case 'cadastro.vincularLoginProfissional': {
        const e = analisar(esquemaVincularLoginProfissional, bruta);
        const { p } = this.registroReal(e.registro);
        if (p.id !== e.profissional) throw recusa('registro-inexistente', 'Registro não encontrado.');
        const atual = this.loginDoRegistro.get(e.registro) ?? '';
        if (atual !== e.versao.trim().toUpperCase())
          throw recusa(
            'conflito-login',
            'O login deste registro mudou em outro terminal. Releia o cadastro e tente de novo.',
            { campos: ['login'] },
          );
        const novo = e.login ?? '';
        if (novo === atual) throw recusa('sem-alteracao', 'O registro já está com este login.');
        const eu = usuario.trim().toUpperCase();
        if (novo === eu || atual === eu)
          throw recusa(
            'a-si-mesmo',
            'Ninguém liga, troca nem desliga o próprio login de profissional (segregação de funções). Peça a outra pessoa.',
            { campos: ['login'] },
          );
        if (!e.justificativa)
          throw recusa(
            'justificativa-obrigatoria',
            'Ligar, trocar ou desligar o login de um profissional exige a justificativa (fica no histórico).',
            { campos: ['justificativa'] },
          );
        let anterior: number | null = null;
        if (e.login) {
          if (!this.candidatos.some(([l]) => l === e.login))
            throw recusa(
              'login-sem-papel',
              'Este login não tem o papel Operador de sistema. Conceda o papel em Usuários e Acessos e volte aqui.',
              { campos: ['login'] },
            );
          const outro = this.logins().find((x) => x.login === e.login)?.profissional;
          if (outro && outro !== p.id)
            throw recusa(
              'login-de-outro-profissional',
              'Este login já está ligado a outro profissional. Desligue-o lá antes (um login, um profissional).',
              { campos: ['login'] },
            );
          // Login único por profissional (a mesma regra do executor, pelo contrato).
          const outroLogin = outroLoginDoProfissional(this.loginsPorRegistro(p.id), e.registro, e.login);
          if (outroLogin)
            throw recusa(RECUSA_OUTRO_LOGIN_NO_PROFISSIONAL, mensagemOutroLoginNoProfissional(outroLogin), {
              campos: ['login'],
            });
          const noRegistro = outroLoginNoRegistro(this.loginsPorRegistro(p.id), e.registro, e.login, atual);
          if (noRegistro)
            throw recusa(RECUSA_OUTRO_LOGIN_NO_PROFISSIONAL, mensagemOutroLoginNoRegistro(noRegistro), {
              campos: ['login'],
            });
          for (const [r, l] of [...this.loginDoRegistro.entries()])
            if (l === e.login) {
              this.loginDoRegistro.delete(r);
              anterior = r;
            }
          this.loginDoRegistro.set(e.registro, e.login);
        } else this.loginDoRegistro.delete(e.registro);
        this.evento(
          p.id,
          {
            evento: !atual ? 'login-ligado' : e.login ? 'login-trocado' : 'login-desligado',
            registro: e.registro,
            loginAntes: atual || null,
            loginDepois: e.login,
            motivo: e.justificativa ?? null,
          },
          usuario,
        );
        // O login saiu de outro registro do mesmo profissional: o histórico daquele registro também mostra.
        if (anterior !== null)
          this.evento(
            p.id,
            {
              evento: 'login-desligado',
              registro: anterior,
              loginAntes: e.login,
              loginDepois: null,
              motivo: e.justificativa ?? null,
            },
            usuario,
          );
        const semAtivo = p.registros.every((r) => !r.ativo) ? 1 : 0;
        return {
          resultado: { registro: e.registro, profissional: p.id, semRegistroAtivo: semAtivo },
          profissional: p,
        };
      }
      case 'cadastro.inativarProfissional':
      case 'cadastro.reativarProfissional': {
        const ativar = op === 'cadastro.reativarProfissional';
        const e = analisar(esquemaSituacaoProfissional, bruta);
        const p = this.profissionais.find((x) => x.id === e.profissional);
        if (!p) throw recusa('profissional-inexistente', 'Profissional não encontrado.');
        let alvo = p.registros.filter((r) => r.ativo !== ativar);
        if (alvo.length === 0)
          throw ativar
            ? recusa('ja-ativo', 'O profissional não tem registro inativo para reativar.')
            : recusa('ja-inativo', 'O profissional já está inativo (nenhum registro ativo).');
        if (ativar) {
          // Só volta o que uma inativação deste sistema desligou (o último evento do registro é 'inativado').
          const ultimo = new Map<number, string>();
          for (const x of this.eventos.get(p.id) ?? [])
            if (
              x.registro !== null &&
              (x.evento === 'inativado' || x.evento === 'reativado') &&
              !ultimo.has(x.registro)
            )
              ultimo.set(x.registro, x.evento);
          alvo = alvo.filter((r) => ultimo.get(r.id) === 'inativado');
          if (alvo.length === 0)
            throw recusa(
              'reativar-registro-a-registro',
              'Os registros deste profissional não foram desligados por uma inativação deste sistema. Reative na aba Registros só os que devem voltar, um a um, com o motivo.',
            );
          for (const r of alvo) this.conferirUnico(p.id, r, r.conselho);
        }
        for (const r of alvo) {
          r.ativo = ativar;
          this.evento(
            p.id,
            {
              evento: ativar ? 'reativado' : 'inativado',
              registro: r.id,
              loginAntes: null,
              loginDepois: null,
              motivo: e.motivo,
            },
            usuario,
          );
        }
        return { resultado: { profissional: p.id, registros: alvo.length }, profissional: p };
      }
      case 'cadastro.excluirProfissional': {
        const e = analisar(esquemaExcluirProfissional, bruta);
        const i = this.profissionais.findIndex((x) => x.id === e.profissional);
        if (i < 0) throw recusa('profissional-inexistente', 'Profissional não encontrado.');
        const v = this.vinculos(e.profissional);
        if (v.length > 0)
          throw recusa(
            'profissional-com-vinculos',
            fraseVinculos(v, 'Este profissional', 'Não pode ser excluído: inative o cadastro.'),
          );
        const p = this.profissionais[i]!;
        this.retratos.push({ tabela: 'profissional', chave: String(p.id), motivo: e.motivo });
        for (const r of p.registros)
          this.retratos.push({ tabela: 'profissional_ocupacao', chave: String(r.id), motivo: e.motivo });
        this.profissionais.splice(i, 1);
        return { resultado: { profissional: p.id }, profissional: null };
      }
      case 'cadastro.excluirRegistroProfissional': {
        const e = analisar(esquemaExcluirRegistroProfissional, bruta);
        const { p, r } = this.registroReal(e.registro);
        const v = this.vinculos(p.id, r.id);
        if (v.length > 0)
          throw recusa(
            'registro-com-atos',
            fraseVinculos(v, 'Este registro', 'Não pode ser excluído: encerre o registro (inativar).'),
          );
        this.retratos.push({ tabela: 'profissional_ocupacao', chave: String(r.id), motivo: e.motivo });
        p.registros = p.registros.filter((x) => x.id !== r.id);
        p.especialidades = p.especialidades.filter((x) => x.registro !== r.id);
        p.lotacao = p.lotacao.filter((x) => x.registro !== r.id);
        p.credenciamentos = p.credenciamentos.filter((x) => x.registro !== r.id);
        this.evento(
          p.id,
          {
            evento: 'registro-excluido',
            registro: r.id,
            loginAntes: null,
            loginDepois: null,
            motivo: e.motivo,
          },
          usuario,
        );
        return { resultado: { registro: r.id, profissional: p.id }, profissional: p };
      }
      case 'cadastro.cadastrarProfissional': {
        const e = analisar(esquemaCadastrarProfissional, bruta);
        if (this.profissionais.some((p) => p.cpf === e.cpf))
          throw recusa(
            'cpf-existente',
            'Já existe um profissional com este CPF. Abra o cadastro dele para incluir o registro.',
            {
              campos: ['cpf'],
            },
          );
        this.conferirRegistroNovo(e.registro, null);
        const p: ProfissionalMem = {
          id: ++this.gerador,
          cpf: e.cpf,
          situacao: 'O',
          linha: linha(e.nome, {
            APELIDO: e.nomeSocial ?? '',
            SEXO: e.sexo ?? null,
            NASC: new Date(e.nascimento ? `${e.nascimento}T00:00:00Z` : SENTINELA),
            NOME_MAE: e.nomeMae ?? '',
            EMAIL: e.email ?? '',
            CELULAR: e.celular ?? ' ',
          }),
          registros: [],
          especialidades: [],
          lotacao: [],
          credenciamentos: [],
        };
        this.profissionais.push(p);
        const registro = this.novoRegistro(p, e.registro);
        return { resultado: { profissional: p.id, registro }, profissional: p };
      }
      case 'cadastro.alterarProfissional': {
        const e = analisar(esquemaAlterarProfissional, bruta);
        const p = this.profissionais.find((x) => x.id === e.profissional);
        if (!p) throw recusa('profissional-inexistente', 'Profissional não encontrado.');
        const lida = lerVersaoColunas(e.versao, COLUNAS_VERSAO_PROFISSIONAL);
        if (!lida) throw recusa('versao-invalida', 'A versão lida pela tela é inválida. Releia o cadastro.');
        const mudou = Object.keys(lida).filter((c) => comparavel(p.linha[c]) !== lida[c]);
        if (mudou.length > 0)
          throw erroConflitoVersao(mudou.map((c) => CAMPO_DA_COLUNA_PROFISSIONAL[c] ?? c));
        const a = e.alteracoes;
        const novos: Record<string, unknown> = {};
        if (a.nome !== undefined) novos['NOME'] = a.nome;
        if (a.nomeSocial !== undefined) novos['APELIDO'] = a.nomeSocial ?? '';
        if (a.sexo !== undefined) novos['SEXO'] = a.sexo;
        if (a.nascimento !== undefined)
          novos['NASC'] = new Date(a.nascimento ? `${a.nascimento}T00:00:00Z` : SENTINELA);
        if (a.nomeMae !== undefined) novos['NOME_MAE'] = a.nomeMae ?? '';
        if (a.email !== undefined) novos['EMAIL'] = a.email ?? '';
        if (a.celular !== undefined) novos['CELULAR'] = a.celular ?? ' ';
        const mudam = Object.entries(novos).filter(([c, v]) => comparavel(p.linha[c]) !== comparavel(v));
        if (mudam.length === 0) throw recusa('sem-alteracao', 'Nenhum campo mudou em relação ao cadastro.');
        p.linha = { ...p.linha, ...Object.fromEntries(mudam) };
        return { resultado: { profissional: p.id }, profissional: p };
      }
      case 'cadastro.incluirRegistroProfissional': {
        const e = analisar(esquemaIncluirRegistroProfissional, bruta);
        const p = this.profissionais.find((x) => x.id === e.profissional);
        if (!p) throw recusa('profissional-inexistente', 'Profissional não encontrado.');
        this.conferirRegistroNovo(e, p.id);
        return { resultado: { registro: this.novoRegistro(p, e), profissional: p.id }, profissional: p };
      }
      case 'cadastro.alterarRegistroProfissional': {
        const e = analisar(esquemaAlterarRegistroProfissional, bruta);
        const { p, r } = this.registroReal(e.registro);
        const lida = lerVersaoColunas(e.versao, COLUNAS_VERSAO_REGISTRO);
        if (!lida) throw recusa('versao-invalida', 'A versão lida pela tela é inválida. Releia o cadastro.');
        const atual = this.linhaRegistro(r);
        const mudou = Object.keys(lida).filter((c) => comparavel(atual[c]) !== lida[c]);
        if (mudou.length > 0)
          throw erroConflitoVersao(mudou.map((c) => CAMPO_DA_COLUNA_PROFISSIONAL[c] ?? c));
        const a = e.alteracoes;
        const conselho = a.conselho ?? r.conselho;
        if (!CONSELHOS.includes(conselho))
          throw recusa('conselho-inexistente', 'Conselho não encontrado no cadastro de conselhos.', {
            campos: ['conselho'],
          });
        const sigla = a.sigla !== undefined ? a.sigla : r.siglaId;
        if (sigla !== null && SIGLAS.find((s) => s.valor === sigla)?.conselho !== conselho)
          throw recusa('sigla-incompativel', 'A sigla não pertence a este conselho.', { campos: ['sigla'] });
        if (a.ativo !== undefined && !e.motivo)
          throw recusa(
            'motivo-obrigatorio',
            'Escreva o motivo do encerramento ou da reativação do registro.',
            {
              campos: ['motivo'],
            },
          );
        const novo = { ...r, conselho, siglaId: sigla, ativo: a.ativo ?? r.ativo };
        if (JSON.stringify(novo) === JSON.stringify(r))
          throw recusa('sem-alteracao', 'Nenhum campo mudou em relação ao registro.');
        if (novo.ativo && (a.ativo === true || a.conselho !== undefined))
          this.conferirUnico(p.id, r, conselho);
        const mudouAtivo = novo.ativo !== r.ativo;
        Object.assign(r, novo);
        if (mudouAtivo)
          this.evento(
            p.id,
            {
              evento: r.ativo ? 'reativado' : 'inativado',
              registro: r.id,
              loginAntes: null,
              loginDepois: null,
              motivo: e.motivo ?? null,
            },
            usuario,
          );
        return { resultado: { registro: r.id, profissional: p.id }, profissional: p };
      }
      case 'cadastro.definirEspecialidadeProfissional': {
        const e = analisar(esquemaEspecialidadeProfissional, bruta);
        const { p } = this.registroReal(e.registro);
        if (!ESPECIALIDADES[e.especialidade])
          throw recusa('especialidade-inexistente', 'Especialidade não encontrada.', {
            campos: ['especialidade'],
          });
        const x = p.especialidades.find((s) => s.registro === e.registro && s.codigo === e.especialidade);
        if (x) {
          if (x.ativo === e.ativo) throw recusa('sem-alteracao', 'A especialidade já está nesta situação.');
          x.ativo = e.ativo;
        } else p.especialidades.push({ registro: e.registro, codigo: e.especialidade, ativo: e.ativo });
        return { resultado: { registro: e.registro, profissional: p.id }, profissional: p };
      }
      case 'cadastro.lotarProfissional': {
        const e = analisar(esquemaLotacaoProfissional, bruta);
        const { p } = this.registroReal(e.registro);
        if (!UNIDADES[e.unidade])
          throw recusa('unidade-inexistente', 'Unidade não encontrada.', { campos: ['unidade'] });
        const novo = {
          registro: e.registro,
          unidade: e.unidade,
          horasAmbulatorio: e.horasAmbulatorio,
          horasHospital: e.horasHospital,
          horasOutros: e.horasOutros,
          ativo: e.ativo,
        };
        const i = p.lotacao.findIndex((x) => x.registro === e.registro && x.unidade === e.unidade);
        if (i >= 0) {
          if (JSON.stringify(p.lotacao[i]) === JSON.stringify(novo))
            throw recusa('sem-alteracao', 'A lotação já está assim.');
          p.lotacao[i] = novo;
        } else p.lotacao.push(novo);
        return { resultado: { registro: e.registro, profissional: p.id }, profissional: p };
      }
      case 'cadastro.credenciarProfissional': {
        const e = analisar(esquemaCredenciamentoProfissional, bruta);
        const { p } = this.registroReal(e.registro);
        const i = p.credenciamentos.findIndex((c) => c.registro === e.registro && c.convenio === e.convenio);
        if (e.credenciado) {
          if (!CONVENIOS[e.convenio])
            throw recusa('convenio-inativo', 'Só convênio ativo recebe credenciamento.', {
              campos: ['convenio'],
            });
          if (i >= 0) throw recusa('sem-alteracao', 'O registro já é credenciado neste convênio.');
          p.credenciamentos.push({ registro: e.registro, convenio: e.convenio });
        } else {
          if (i < 0) throw recusa('sem-alteracao', 'O registro não é credenciado neste convênio.');
          p.credenciamentos.splice(i, 1);
        }
        return { resultado: { registro: e.registro, profissional: p.id }, profissional: p };
      }
    }
  }
}
