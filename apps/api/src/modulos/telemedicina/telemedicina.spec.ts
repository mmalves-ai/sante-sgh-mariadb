// Telemedicina no serviço, sobre a porta EM MEMÓRIA e dublês mínimos do atendimento, do cadastro, do apoio de gravação e
// do portal (nada conecta a banco): a teleconsulta de hoje da paciente sintética 1003 — a sala de espera no portal com
// o termo e o local, a recusa antes do médico, a lista e o detalhe do médico com o alerta do crônico, o início que
// exige a ciência do alerta, abre a sala simulada e liga o atendimento, o outro médico recusado, a entrada do paciente
// na sala e o encerramento; a teleinterconsulta pedida, respondida só pelo convidado e cancelada só por quem pediu; a
// marcação que sumiu da agenda; a marca nos documentos. Pacientes e nomes SINTÉTICOS.
import {
  esquemaCancelarTeleinterconsulta,
  esquemaEncerrarTeleconsulta,
  esquemaEntrarSalaEspera,
  esquemaIniciarTeleconsulta,
  esquemaResponderTeleinterconsulta,
  esquemaSolicitarTeleinterconsulta,
  EVENTOS_AUDITAVEIS,
  VERSAO_DECLARACAO_MEDICO,
  VERSAO_TERMO_TELECONSULTA,
} from '@sgh/contratos';
import { beforeAll, describe, expect, it } from 'vitest';
import { ErroProblema } from '../../problema.filter.js';
import type { PortaAtendimento } from '../atendimento/porta.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { PortaCadastro } from '../cadastro/porta.js';
import type { AlvoSgh, ApoioGravacao } from '../exames/public-api.js';
import type { PortalNoPedido, ServicoPortalPaciente } from '../portal-paciente/aplicacao/servico.js';
import type { GravadorTelemedicina } from './porta.js';
import { MARCACAO_SEMENTE_TELE, PortaTelemedicinaMemoria } from './porta-memoria.js';
import { ProvedorSimulado } from './provedor.js';
import { ServicoTelemedicina } from './servico.js';

const E = EVENTOS_AUDITAVEIS;
// 10:10 em São Paulo: a teleconsulta da semente (10:00) está com a sala de espera aberta.
const AGORA = new Date('2030-03-12T13:10:00Z');
const HOJE = '2030-03-12';
const tele = new PortaTelemedicinaMemoria(() => AGORA, { semente: true });
let abertos = 0;

const PROFS: Record<
  string,
  { vinculo: number; crm: number; nome: string; codigoCbo: string; conselhoAtivo: boolean }
> = {
  'SINT.MEDICO': {
    vinculo: 7101,
    crm: 52001,
    nome: 'ANA MEDICA SINTETICO',
    codigoCbo: '225125',
    conselhoAtivo: true,
  },
  'SINT.CARDIO': {
    vinculo: 7102,
    crm: 52002,
    nome: 'CARLOS CARDIO SINTETICO',
    codigoCbo: '225120',
    conselhoAtivo: true,
  },
};
const atendimento = {
  relogio: async () => ({ hoje: HOJE, agora: `${HOJE}T10:10:00` }),
  profissional: async (_c: unknown, login: string) => PROFS[login] ?? null,
  marcacao: async (_c: unknown, id: number) =>
    id === MARCACAO_SEMENTE_TELE || id > 880_000
      ? {
          convenio: 306,
          especialidade: 15,
          unidade: 1,
          centroCusto: 300600,
          procedimento: 10101012,
          retorno: false,
          registro: 0,
        }
      : null,
  detalhe: async () => ({ paciente: { id: 1003 }, desfecho: null }),
  apoio: async () => ({
    especialidades: [],
    unidades: [],
    centrosCusto: [],
    profissionais: [
      { id: 7101, nome: 'ANA MEDICA SINTETICO', ativo: true, crm: 52001, cbo: '225125' },
      { id: 7102, nome: 'CARLOS CARDIO SINTETICO', ativo: true, crm: 52002, cbo: '225120' },
    ],
  }),
  atendimentosDoDia: async () => ({ itens: [] }),
  cid: async () => [],
} as unknown as PortaAtendimento;
const cadastro = {
  lerPacientes: async (_c: unknown, ids: readonly number[]) =>
    ids.map((id) => ({ id, nome: `PACIENTE ${id} SINTETICO`, nomeSocial: null, prontuario: id })),
} as unknown as PortaCadastro;
const apoio = {
  liberacao: async () => ({ ligada: true, motivo: null }),
  sgh: async <T>(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvo: AlvoSgh | ((r: T) => AlvoSgh),
    fn: (g: GravadorTelemedicina) => Promise<T>,
  ) =>
    tele.gravar(
      s.porta,
      (r: T) => {
        const a = typeof alvo === 'function' ? alvo(r) : alvo;
        return {
          estabelecimento: null,
          usuario: null,
          acao: 'operacao' as const,
          entidade: a.tabela,
          entidadeId: a.id ? Number(a.id) : null,
          dadosDepois: { evento, recurso, chave: a.chave ?? null, paciente: a.paciente ?? null },
          correlacao: 'teste',
        };
      },
      fn,
    ),
  executar: async () => {
    abertos++;
    return { resultado: { atendimento: 555 }, repetida: false, trilha: null };
  },
} as unknown as ApoioGravacao<GravadorTelemedicina>;
const portal = { rede: '', titularComEscopo: () => ({ paciente: 1003 }) } as unknown as ServicoPortalPaciente;
const servico = new ServicoTelemedicina(
  tele,
  atendimento,
  cadastro,
  apoio,
  new ProvedorSimulado(),
  null,
  portal,
  () => AGORA,
);

const sessao = (login: string, usuario: number): SessaoCadastro => ({
  req: {} as never,
  hospital: 'aa',
  rede: '',
  login,
  porta: { cliente: 'teste', estabelecimento: 1, usuario, correlacao: 'teste', rede: '', hospital: 'aa' },
  pode: () => true,
});
const medico = sessao('SINT.MEDICO', 1);
const cardio = sessao('SINT.CARDIO', 2);
const n = {
  c: { rede: '', hospital: 'aa', login: 'portal', estacao: 'portal', correlacao: 'teste' },
  conta: { id: 1 },
  s: {},
  titulares: [],
} as unknown as PortalNoPedido;
const LOCAL = { uf: 'RJ', municipio: 'petropolis', tipo: 'residencia' };
const eventos = () => tele.trilhas.map((x) => (x.dadosDepois as { evento: string }).evento);

describe('teleconsulta: sala de espera, início pelo médico, sala e encerramento', () => {
  let id = 0;

  beforeAll(async () => {
    const l = await servico.listaPortal(n);
    id = l.itens[0]!.id;
  });

  it('o portal lista a de hoje; a sala de espera grava o termo e o local, e a trilha não leva o local', async () => {
    const l = await servico.listaPortal(n);
    expect(l).toMatchObject({ ligada: true, termo: { versao: VERSAO_TERMO_TELECONSULTA } });
    expect(l.itens[0]).toMatchObject({ situacao: 'agendada', podeEntrar: true, termo: null, sala: null });
    await expect(servico.entrarNaSala(n, id)).rejects.toBeInstanceOf(ErroProblema);
    const e = await servico.entrarSalaEspera(
      n,
      id,
      esquemaEntrarSalaEspera.parse({ termo: VERSAO_TERMO_TELECONSULTA, aceito: true, local: LOCAL }),
    );
    expect(e).toMatchObject({ situacao: 'aguardando', termo: { versao: VERSAO_TERMO_TELECONSULTA } });
    expect(tele.trilhas.at(-1)).toMatchObject({
      entidade: 'teleconsulta',
      entidadeId: id,
      dadosDepois: {
        evento: E.teleconsultaSalaEspera.codigo,
        chave: `termo=${VERSAO_TERMO_TELECONSULTA}`,
        paciente: 1003,
      },
    });
    expect(JSON.stringify(tele.trilhas)).not.toMatch(/PETROPOLIS|petropolis/);
    await expect(servico.detalhePortal(n, 999_999)).rejects.toBeInstanceOf(ErroProblema);
  });

  it('o médico vê o paciente na espera e o alerta do crônico; outro médico não vê a sala', async () => {
    const l = await servico.lista(medico, { data: null, minhas: true });
    expect(l).toMatchObject({ ligada: true, podeRealizar: true, profissional: { vinculo: 7101 } });
    expect(l.teleconsultas[0]).toMatchObject({ id, pacienteNaEspera: true, paciente: { id: 1003 } });
    const d = await servico.detalhe(medico, id);
    expect(d).toMatchObject({
      situacao: 'aguardando',
      marcacao: MARCACAO_SEMENTE_TELE,
      alerta: { cronico: true, alerta: true, diasSemPresencial: 200 },
      abertura: { convenio: 306, especialidade: 15, unidade: 1, centroCusto: 300600 },
      acoes: { iniciar: { pode: true } },
    });
  });

  it('iniciar exige a ciência do alerta; abre a sala simulada e liga o atendimento; o outro médico é recusado', async () => {
    const versao = (await servico.detalhe(medico, id)).versao;
    const base = {
      declaracao: VERSAO_DECLARACAO_MEDICO,
      cidPrincipal: 2,
      procedimento: 10101012,
      especialidade: 15,
      unidade: 1,
      centroCusto: 300600,
      versao,
    };
    await expect(servico.iniciar(medico, id, esquemaIniciarTeleconsulta.parse(base))).rejects.toBeInstanceOf(
      ErroProblema,
    );
    expect(abertos).toBe(0);
    const ok = await servico.iniciar(
      medico,
      id,
      esquemaIniciarTeleconsulta.parse({ ...base, cienteAlerta: true }),
    );
    expect(ok.teleconsulta).toMatchObject({
      situacao: 'em-andamento',
      medico: 'SINT.MEDICO',
      atendimento: 555,
      sala: { provedor: 'simulado' },
      acoes: { iniciar: { pode: false }, encerrar: { pode: true } },
    });
    expect(ok.teleconsulta.sala?.endereco).toMatch(/^simulado:SIM-SALA-[0-9A-F]{16}:medico$/);
    expect(eventos()).toContain(E.teleconsultaSalaAberta.codigo);
    expect(tele.trilhas.at(-1)).toMatchObject({
      dadosDepois: { evento: E.teleconsultaIniciada.codigo, chave: 'atendimento=555' },
    });
    const doOutro = await servico.detalhe(cardio, id);
    expect(doOutro).toMatchObject({ sala: null, acoes: { encerrar: { pode: false } } });
    await expect(
      servico.encerrar(
        cardio,
        id,
        esquemaEncerrarTeleconsulta.parse({ motivo: 'concluida', versao: doOutro.versao }),
      ),
    ).rejects.toBeInstanceOf(ErroProblema);
    expect(await servico.atendimentoEmTeleconsulta(medico.porta, 555)).toBe(true);
    expect(await servico.atendimentoEmTeleconsulta(medico.porta, 556)).toBe(false);
  });

  it('o paciente entra (a primeira entrada vai à trilha) e o médico encerra', async () => {
    const d = await servico.detalhePortal(n, id);
    expect(d).toMatchObject({ situacao: 'em-andamento', sala: { provedor: 'simulado' } });
    const antes = tele.trilhas.length;
    await servico.entrarNaSala(n, id);
    expect(tele.trilhas.at(-1)).toMatchObject({
      dadosDepois: { evento: E.teleconsultaPacienteEntrou.codigo },
    });
    await servico.entrarNaSala(n, id);
    expect(tele.trilhas.length).toBe(antes + 1);
    const versao = (await servico.detalhe(medico, id)).versao;
    const fim = await servico.encerrar(
      medico,
      id,
      esquemaEncerrarTeleconsulta.parse({ motivo: 'concluida', versao }),
    );
    expect(fim.teleconsulta).toMatchObject({ situacao: 'encerrada', motivoEncerramento: 'concluida' });
    await expect(
      servico.encerrar(
        medico,
        id,
        esquemaEncerrarTeleconsulta.parse({ motivo: 'concluida', versao: fim.teleconsulta.versao }),
      ),
    ).rejects.toBeInstanceOf(ErroProblema);
  });

  it('a marcação pelo portal cria a teleconsulta; a que sumiu da agenda sai cancelada; o cancelamento a cancela', async () => {
    await servico.aoMarcar(n, 1003, {
      marcacao: 880_996,
      agenda: 902,
      nomeAgenda: 'CARDIOLOGIA',
      crm: 52001,
      data: '2030-03-13',
      hora: '10:00',
    });
    expect(tele.trilhas.at(-1)).toMatchObject({
      dadosDepois: { evento: E.teleconsultaAgendada.codigo, chave: 'marcacao=880996' },
    });
    const nova = await servico.daMarcacao(n, 880_996);
    expect(nova).toMatchObject({ situacao: 'agendada' });
    tele.apagarMarcacao('aa', 880_996);
    const l = await servico.listaPortal(n);
    expect(l.itens.find((x) => x.id === nova!.id)).toMatchObject({
      situacao: 'cancelada',
      podeEntrar: false,
    });
    await servico.aoMarcar(n, 1003, {
      marcacao: 880_995,
      agenda: 902,
      nomeAgenda: 'CARDIOLOGIA',
      crm: 52001,
      data: '2030-03-14',
      hora: '10:00',
    });
    await servico.aoCancelar(n, 1003, 880_995);
    expect(tele.trilhas.at(-1)).toMatchObject({ dadosDepois: { evento: E.teleconsultaCancelada.codigo } });
    expect(await servico.daMarcacao(n, 880_995)).toBeNull();
  });
});

describe('teleinterconsulta', () => {
  it('pedida no atendimento aberto; responde só o convidado; cancela só quem pediu', async () => {
    const pedido = (motivo: string) =>
      esquemaSolicitarTeleinterconsulta.parse({
        atendimento: 555,
        convidado: 7102,
        motivo,
        consentimento: true,
      });
    await expect(
      servico.solicitarInterconsulta(
        medico,
        esquemaSolicitarTeleinterconsulta.parse({
          atendimento: 555,
          convidado: 7101,
          motivo: 'Eu mesmo SINTETICO',
          consentimento: true,
        }),
      ),
    ).rejects.toBeInstanceOf(ErroProblema);
    const s = await servico.solicitarInterconsulta(medico, pedido('Opinião sobre a arritmia SINTETICO'));
    const t = s.teleconsulta;
    expect(t).toMatchObject({
      modalidade: 'teleinterconsulta',
      situacao: 'solicitada',
      interconsulta: { convidado: { vinculo: 7102 }, minha: true, paraMim: false },
      acoes: { responder: { pode: false }, cancelar: { pode: true } },
    });
    expect(tele.trilhas.at(-1)).toMatchObject({
      dadosDepois: { evento: E.teleinterconsultaSolicitada.codigo, chave: 'convidado=7102' },
    });
    await expect(
      servico.responderInterconsulta(
        medico,
        t.id,
        esquemaResponderTeleinterconsulta.parse({ parecer: 'De quem pediu SINTETICO', versao: t.versao }),
      ),
    ).rejects.toBeInstanceOf(ErroProblema);
    const lista = await servico.lista(cardio, { data: null, minhas: false });
    expect(lista.interconsultas.map((x) => x.id)).toContain(t.id);
    const sala = await servico.abrirSalaInterconsulta(cardio, t.id, t.versao);
    expect(sala.teleconsulta.sala?.endereco).toMatch(/:convidado$/);
    const r = await servico.responderInterconsulta(
      cardio,
      t.id,
      esquemaResponderTeleinterconsulta.parse({
        parecer: 'Sem contraindicação SINTETICO',
        versao: sala.teleconsulta.versao,
      }),
    );
    expect(r.teleconsulta).toMatchObject({ situacao: 'respondida', interconsulta: { paraMim: true } });
    expect(JSON.stringify(tele.trilhas)).not.toMatch(/contraindica|arritmia/);
    const s2 = (await servico.solicitarInterconsulta(medico, pedido('Segunda opinião SINTETICO')))
      .teleconsulta;
    await expect(
      servico.cancelarInterconsulta(
        cardio,
        s2.id,
        esquemaCancelarTeleinterconsulta.parse({ motivo: 'Não sou eu', versao: s2.versao }),
      ),
    ).rejects.toBeInstanceOf(ErroProblema);
    const c = await servico.cancelarInterconsulta(
      medico,
      s2.id,
      esquemaCancelarTeleinterconsulta.parse({ motivo: 'Paciente melhorou', versao: s2.versao }),
    );
    expect(c.teleconsulta).toMatchObject({ situacao: 'cancelada' });
  });
});
