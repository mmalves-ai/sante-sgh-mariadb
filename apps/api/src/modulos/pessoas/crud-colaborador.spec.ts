// W0-06, parte 3a: a correção cadastral do colaborador (nome, matrícula, tipo de vínculo, admissão; motivo, versão e
// valor anterior) e a alteração do dependente com versão a partir de uma data (IR e salário-família), sobre a porta EM
// MEMÓRIA (dados SINTÉTICOS; nada conecta a banco).
import type {
  ChaveLiberacao as ChaveGravada,
  PrerequisitoRecurso as PrerequisitoGravado,
} from '../config/public-api.js';
import {
  esquemaAlterarDependente,
  esquemaCorrigirColaborador,
  esquemaLigarCargoColaborador,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idUsuarioSintetico } from '../acesso/fonte-sintetica.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { CifraCpf } from './cifra-cpf.js';
import { cpfSintetico, PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from './porta-memoria.js';
import { ServicoPessoas } from './servico.js';

/** Contexto da porta do teste: um estabelecimento sintético distinto por código de hospital. */
const ESTABS = new Map<string, number>();
const ctxDe = (hospital: string) => {
  if (!ESTABS.has(hospital)) ESTABS.set(hospital, ESTABS.size + 1);
  return {
    cliente: 'sintetico',
    estabelecimento: ESTABS.get(hospital) ?? null,
    usuario: 7,
    correlacao: 'teste-colaborador',
    rede: 'rede-sintetica',
    hospital,
  };
};

const ligada: ChaveGravada = {
  id: 'pessoas.colaborador',
  tipo: 'recurso',
  chave: 'pessoas.colaborador',
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};
const conferencia: PrerequisitoGravado = {
  recurso: 'pessoas.colaborador',
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
};
const C = PESSOAS_SINTETICAS_M52;

function montar() {
  const porta = new PortaPessoasMemoria();
  porta.hojeFixo = '2026-10-25';
  const trilha = new RegistradorTrilhaMemoria();
  const servico = new ServicoPessoas(
    porta,
    trilha,
    fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [ligada],
      prerequisitosIniciais: () => [conferencia],
    }),
    null,
    new CifraCpf(Buffer.alloc(32, 7)),
  );
  return { porta, trilha, servico };
}
let k = 0;
const sessao = (hospital: string): SessaoCadastro => ({
  req: {
    headers: { 'idempotency-key': `w006-colab-${++k}` },
    ip: '127.0.0.1',
    sgh: { sessao: { unidadeAtiva: null } },
  } as never,
  hospital,
  rede: 'rede-sintetica',
  login: 'SINT.RH',
  porta: ctxDe(hospital),
  pode: () => true,
});
const admissao = (extra: Record<string, unknown> = {}) => ({
  cpf: C.comLogin.cpf,
  nome: 'ENFERMEIRA SINTETICA UM',
  tipo: 'clt' as const,
  admissao: '2026-10-01',
  cargo: 'Enfermeira assistencial',
  funcao: null,
  cargaSemanalHoras: 36,
  lotacao: { centroCusto: 9521, unidade: 1, setor: 'Clínica médica' },
  matricula: 'SINT-C-001',
  profissional: C.comLogin.profissional as number | null,
  usuario: idUsuarioSintetico(C.comLogin.login) as number | null,
  ...extra,
});
async function recusa(p: Promise<unknown>): Promise<{ status: number; codigo: unknown }> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroProblema);
  const x = e as ErroProblema;
  return { status: x.getStatus(), codigo: x.extras['codigo'] };
}
const MOTIVO = 'Erro de digitação na admissão (conferido no contrato)';

describe('correção cadastral do colaborador (W0-06)', () => {
  it('corrige nome, matrícula e admissão com motivo: versão nova, linha de correção e o valor anterior', async () => {
    const { servico, trilha } = montar();
    const h = 't-corr';
    const v = (await servico.admitir(sessao(h), admissao())).id;
    const r = await servico.corrigir(sessao(h), {
      vinculo: v,
      versao: 0,
      nome: 'ENFERMEIRA SINTETICA UNO',
      matricula: 'SINT-C-010',
      admissao: '2026-09-28',
      motivo: MOTIVO,
    });
    expect(r.mensagem).toMatch(/eSocial/);
    const f = await servico.ficha(sessao(h), v);
    expect(f).toMatchObject({
      versao: 1,
      nome: 'ENFERMEIRA SINTETICA UNO',
      matricula: 'SINT-C-010',
      admissao: '2026-09-28',
      tipo: 'clt',
    });
    const linha = f.historico.find((x) => x.tipo === 'correcao');
    expect(linha).toMatchObject({ vigencia: '2026-10-25', motivo: MOTIVO, registradoPor: 'SINT.RH' });
    expect(linha?.antes).toContain('ENFERMEIRA SINTETICA UM');
    expect(linha?.depois).toContain('2026-09-28');
    expect(f.correcoes).toEqual([
      expect.objectContaining({
        operacao: 'colaborador.corrigido',
        antes: { nome: 'ENFERMEIRA SINTETICA UM', matricula: 'SINT-C-001', admissao: '2026-10-01' },
        depois: { nome: 'ENFERMEIRA SINTETICA UNO', matricula: 'SINT-C-010', admissao: '2026-09-28' },
        motivo: MOTIVO,
        por: 'SINT.RH',
      }),
    ]);
    expect(trilha.eventos.some((l) => l.evento === 'pessoas.colaborador.corrigido')).toBe(true);
  });

  it('recusa: nada a corrigir, versão velha, matrícula em uso, tipo que não comporta a carga', async () => {
    const { servico } = montar();
    const h = 't-corr-rec';
    const v = (await servico.admitir(sessao(h), admissao())).id;
    await servico.admitir(
      sessao(h),
      admissao({
        cpf: C.nova.cpf,
        nome: 'PESSOA NOVA SINTETICA',
        matricula: 'SINT-C-002',
        profissional: null,
        usuario: null,
      }),
    );
    const base = { vinculo: v, versao: 0, motivo: MOTIVO };
    expect(
      await recusa(servico.corrigir(sessao(h), { ...base, nome: 'ENFERMEIRA SINTETICA UM' })),
    ).toMatchObject({
      status: 409,
      codigo: 'nada-a-corrigir',
    });
    expect(
      await recusa(servico.corrigir(sessao(h), { ...base, versao: 5, nome: 'OUTRO NOME' })),
    ).toMatchObject({
      status: 409,
    });
    expect(await recusa(servico.corrigir(sessao(h), { ...base, matricula: 'SINT-C-002' }))).toMatchObject({
      status: 409,
      codigo: 'matricula-em-uso',
    });
    expect(await recusa(servico.corrigir(sessao(h), { ...base, tipo: 'estagiario' }))).toMatchObject({
      status: 409,
      codigo: 'carga-acima-do-limite',
    });
    expect(await recusa(servico.corrigir(sessao(h), { ...base, admissao: '2027-01-30' }))).toMatchObject({
      status: 409,
      codigo: 'admissao-futura',
    });
    // Nada mudou com as recusas.
    expect((await servico.ficha(sessao(h), v)).versao).toBe(0);
  });

  it('a admissão não passa da primeira mudança funcional; a correção não trava a mudança retroativa', async () => {
    const { servico } = montar();
    const h = 't-corr-mud';
    const v = (await servico.admitir(sessao(h), admissao())).id;
    await servico.mudar(sessao(h), {
      vinculo: v,
      versao: 0,
      vigencia: '2026-10-10',
      cargo: 'Enfermeira supervisora',
      motivo: 'Promoção sintética aprovada',
    });
    expect(
      await recusa(
        servico.corrigir(sessao(h), { vinculo: v, versao: 1, admissao: '2026-10-15', motivo: MOTIVO }),
      ),
    ).toMatchObject({ status: 409, codigo: 'admissao-depois-de-mudanca' });
    await servico.corrigir(sessao(h), { vinculo: v, versao: 1, matricula: null, motivo: MOTIVO });
    // A linha da correção (vigência de hoje) não vira o piso da próxima mudança.
    await servico.mudar(sessao(h), {
      vinculo: v,
      versao: 2,
      vigencia: '2026-10-12',
      cargaSemanalHoras: 30,
      motivo: 'Redução de jornada sintética',
    });
    expect((await servico.ficha(sessao(h), v)).matricula).toBeNull();
  });

  it('o desligado também se corrige, mas a admissão não fica depois do desligamento', async () => {
    const { servico, porta } = montar();
    const h = 't-corr-desl';
    const v = (
      await servico.admitir(sessao(h), admissao({ cpf: C.nova.cpf, profissional: null, usuario: null }))
    ).id;
    await porta.gravarSgh(ctxDe(h), null as never, (g) =>
      g.desligarVinculo({
        id: v,
        versao: 0,
        data: '2026-10-20',
        tipoRescisao: 1,
        motivo: 'Desligamento sintético',
        por: 'X',
      }),
    );
    expect(
      await recusa(
        servico.corrigir(sessao(h), { vinculo: v, versao: 1, admissao: '2026-10-21', motivo: MOTIVO }),
      ),
    ).toMatchObject({ status: 409, codigo: 'admissao-depois-do-desligamento' });
    await servico.corrigir(sessao(h), {
      vinculo: v,
      versao: 1,
      nome: 'NOME CORRIGIDO SINTETICO',
      motivo: MOTIVO,
    });
    expect(await servico.ficha(sessao(h), v)).toMatchObject({
      estado: 'desligado',
      nome: 'NOME CORRIGIDO SINTETICO',
    });
  });

  it('o esquema exige o motivo e algo a corrigir', () => {
    expect(esquemaCorrigirColaborador.safeParse({ vinculo: 1, versao: 0, nome: 'NOME NOVO' }).success).toBe(
      false,
    );
    expect(esquemaCorrigirColaborador.safeParse({ vinculo: 1, versao: 0, motivo: MOTIVO }).success).toBe(
      false,
    );
    expect(
      esquemaCorrigirColaborador.safeParse({ vinculo: 1, versao: 0, motivo: MOTIVO, tipo: 'clt' }).success,
    ).toBe(true);
  });
});

describe('alteração do dependente com versão (W0-06)', () => {
  async function comDependente() {
    const m = montar();
    const h = `t-dep-alt-${++k}`;
    const v = (await m.servico.admitir(sessao(h), admissao())).id;
    const d = (
      await m.servico.incluirDependente(sessao(h), {
        vinculo: v,
        nome: 'FILHO SINTETICO',
        nascimento: '2020-05-10',
        parentesco: '03',
        cpf: cpfSintetico('900520019'),
        dependenteIr: false,
        dependenteSalarioFamilia: false,
      })
    ).id;
    return { ...m, h, v, d };
  }
  const MOT = 'Marca do IR esquecida na inclusão';

  it('a versão nova vale a partir da data; a anterior acaba na véspera e fica guardada com o valor anterior', async () => {
    const { servico, porta, trilha, h, v, d } = await comDependente();
    const r = await servico.alterarDependente(sessao(h), {
      vinculo: v,
      dependente: d,
      desde: '2026-10-01',
      dependenteIr: true,
      motivo: MOT,
    });
    expect(r.id).not.toBe(d);
    const f = await servico.ficha(sessao(h), v);
    expect(f.dependentes).toEqual([
      expect.objectContaining({ id: r.id, desde: '2026-10-01', dependenteIr: true, nome: 'FILHO SINTETICO' }),
    ]);
    expect(f.dependentes[0]!.cpfMascarado).not.toBeNull();
    const estado = (
      porta as unknown as { estados: Map<string, { dependentes: Map<number, unknown> }> }
    ).estados.get(h)!;
    expect(estado.dependentes.get(d)).toMatchObject({
      ate: '2026-09-30',
      motivoFim: `Alterado (nova versão): ${MOT}`,
    });
    expect(estado.dependentes.get(r.id)).toMatchObject({ anterior: d, ate: null });
    expect(f.correcoes).toEqual([
      expect.objectContaining({
        operacao: 'dependente.alterado',
        antes: { dependente: d, dependenteIr: false },
        depois: { dependente: r.id, desde: '2026-10-01', dependenteIr: true },
        motivo: MOT,
      }),
    ]);
    expect(trilha.eventos.some((l) => l.evento === 'pessoas.dependente.alterado')).toBe(true);
    // A versão encerrada não se altera de novo (404); a nova só depois da sua data.
    expect(
      await recusa(
        servico.alterarDependente(sessao(h), {
          vinculo: v,
          dependente: d,
          desde: '2026-10-20',
          nome: 'OUTRO NOME',
          motivo: MOT,
        }),
      ),
    ).toMatchObject({ status: 404 });
    expect(
      await recusa(
        servico.alterarDependente(sessao(h), {
          vinculo: v,
          dependente: r.id,
          desde: '2026-10-01',
          dependenteSalarioFamilia: true,
          motivo: MOT,
        }),
      ),
    ).toMatchObject({ status: 409, codigo: 'desde-antes-da-versao' });
  });

  it('recusa: nada a alterar, data futura, antes do nascimento; o CPF trocado vale mesmo com o mesmo final', async () => {
    const { servico, h, v, d } = await comDependente();
    const base = { vinculo: v, dependente: d, desde: '2026-10-01', motivo: MOT };
    expect(
      await recusa(servico.alterarDependente(sessao(h), { ...base, dependenteIr: false })),
    ).toMatchObject({
      status: 409,
      codigo: 'nada-a-alterar',
    });
    expect(
      await recusa(
        servico.alterarDependente(sessao(h), { ...base, desde: '2026-10-26', dependenteIr: true }),
      ),
    ).toMatchObject({ status: 409, codigo: 'desde-futuro' });
    expect(
      await recusa(
        servico.alterarDependente(sessao(h), { ...base, desde: '2019-01-01', dependenteIr: true }),
      ),
    ).toMatchObject({ status: 409, codigo: 'desde-antes-do-nascimento' });
    const r = await servico.alterarDependente(sessao(h), { ...base, cpf: null });
    const f = await servico.ficha(sessao(h), v);
    expect(f.dependentes.find((x) => x.id === r.id)?.cpfMascarado).toBeNull();
    expect(f.correcoes?.[0]?.depois).toMatchObject({ cpf: null });
  });

  it('o esquema exige o motivo, a data e algo a alterar', () => {
    const ok = { vinculo: 1, dependente: 2, desde: '2026-10-01', motivo: MOT };
    expect(esquemaAlterarDependente.safeParse(ok).success).toBe(false);
    expect(esquemaAlterarDependente.safeParse({ ...ok, dependenteIr: true }).success).toBe(true);
    expect(esquemaAlterarDependente.safeParse({ ...ok, dependenteIr: true, motivo: 'curto' }).success).toBe(
      false,
    );
  });
});

describe('cargo do quadro ligado ao colaborador (W0-06, parte 5d-3a)', () => {
  const QUADRO = new Map([
    [11, { id: 11, nome: 'ENFERMEIRO ASSISTENCIAL', cbo: '223505', ativo: true }],
    [12, { id: 12, nome: 'TECNICO DE ENFERMAGEM', cbo: '322205', ativo: true }],
    [13, { id: 13, nome: 'CARGO INATIVO SINTETICO', cbo: '322205', ativo: false }],
  ]);
  function comQuadro() {
    const m = montar();
    m.porta.quadroDeCargos = async (hospital, id) =>
      hospital.startsWith('t-') ? (QUADRO.get(id) ?? null) : null;
    return m;
  }

  it('liga, troca e retira o cargo com motivo: versão nova, linha de correção e o valor anterior', async () => {
    const { servico, trilha } = comQuadro();
    const h = 't-cargo';
    const v = (await servico.admitir(sessao(h), admissao())).id;
    expect((await servico.ficha(sessao(h), v)).cargoQuadro).toBeNull();
    const r = await servico.ligarCargo(sessao(h), { vinculo: v, versao: 0, cargo: 11, motivo: MOTIVO });
    expect(r.mensagem).toMatch(/ligado/);
    let f = await servico.ficha(sessao(h), v);
    expect(f).toMatchObject({
      versao: 1,
      cargo: 'Enfermeira assistencial',
      cargoQuadro: { id: 11, nome: 'ENFERMEIRO ASSISTENCIAL', cbo: '223505', ativo: true },
    });
    await servico.ligarCargo(sessao(h), { vinculo: v, versao: 1, cargo: 12, motivo: MOTIVO });
    await servico.ligarCargo(sessao(h), { vinculo: v, versao: 2, cargo: null, motivo: MOTIVO });
    f = await servico.ficha(sessao(h), v);
    expect(f.cargoQuadro).toBeNull();
    expect(f.cargo).toBe('Enfermeira assistencial');
    const linhas = f.historico.filter((x) => x.tipo === 'correcao');
    expect(linhas).toHaveLength(3);
    expect(linhas.map((x) => x.depois)).toContain('cargo do quadro: TECNICO DE ENFERMAGEM (CBO 322205)');
    expect(f.correcoes?.filter((c) => c.operacao === 'colaborador.cargo_ligado')).toHaveLength(3);
    expect(f.correcoes).toContainEqual(
      expect.objectContaining({
        operacao: 'colaborador.cargo_ligado',
        antes: { cargo: 11, cargoQuadro: 'ENFERMEIRO ASSISTENCIAL (CBO 223505)' },
        depois: { cargo: 12, cargoQuadro: 'TECNICO DE ENFERMAGEM (CBO 322205)' },
        motivo: MOTIVO,
        por: 'SINT.RH',
      }),
    );
    expect(trilha.eventos.filter((l) => l.evento === 'pessoas.colaborador.cargo_ligado')).toHaveLength(3);
  });

  it('recusa: o mesmo cargo, versão velha, cargo inativo, de outro estabelecimento, desligado', async () => {
    const { servico, porta } = comQuadro();
    const h = 't-cargo-rec';
    const v = (await servico.admitir(sessao(h), admissao())).id;
    await servico.ligarCargo(sessao(h), { vinculo: v, versao: 0, cargo: 11, motivo: MOTIVO });
    const base = { vinculo: v, versao: 1, motivo: MOTIVO };
    expect(await recusa(servico.ligarCargo(sessao(h), { ...base, cargo: 11 }))).toMatchObject({
      status: 409,
      codigo: 'nada-a-corrigir',
    });
    expect(await recusa(servico.ligarCargo(sessao(h), { ...base, versao: 0, cargo: 12 }))).toMatchObject({
      status: 409,
    });
    expect(await recusa(servico.ligarCargo(sessao(h), { ...base, cargo: 13 }))).toMatchObject({
      status: 409,
      codigo: 'cargo-inativo',
    });
    expect(await recusa(servico.ligarCargo(sessao(h), { ...base, cargo: 99 }))).toMatchObject({
      status: 404,
      codigo: 'cargo-nao-encontrado',
    });
    const h2 = 'outro-hospital';
    const v2 = (await servico.admitir(sessao(h2), admissao())).id;
    expect(
      await recusa(servico.ligarCargo(sessao(h2), { vinculo: v2, versao: 0, cargo: 11, motivo: MOTIVO })),
    ).toMatchObject({ status: 404, codigo: 'cargo-nao-encontrado' });
    await porta.gravarSgh(ctxDe(h), null as never, (g) =>
      g.desligarVinculo({
        id: v,
        versao: 1,
        data: '2026-10-20',
        tipoRescisao: 1,
        motivo: 'Desligamento sintético',
        por: 'X',
      }),
    );
    expect(await recusa(servico.ligarCargo(sessao(h), { ...base, versao: 2, cargo: 12 }))).toMatchObject({
      status: 409,
      codigo: 'desligado',
    });
    // O desligado pode perder o cargo que tinha (a correção do cadastro).
    await servico.ligarCargo(sessao(h), { ...base, versao: 2, cargo: null });
    expect((await servico.ficha(sessao(h), v)).cargoQuadro).toBeNull();
  });

  it('o esquema exige o motivo e aceita null para retirar', () => {
    expect(esquemaLigarCargoColaborador.safeParse({ vinculo: 1, versao: 0, cargo: 2 }).success).toBe(false);
    expect(
      esquemaLigarCargoColaborador.safeParse({ vinculo: 1, versao: 0, cargo: null, motivo: MOTIVO }).success,
    ).toBe(true);
    expect(
      esquemaLigarCargoColaborador.safeParse({ vinculo: 1, versao: 0, cargo: 2, motivo: 'curto' }).success,
    ).toBe(false);
  });
});
