// M22, corretor (dados SINTÉTICOS, portas em memória; nada conecta a banco):
//   - vínculo assistencial (o mesmo controle do prontuário ao vivo): com a restrição do estabelecimento, sem
//     vínculo, 403 `sem-vinculo` no formulário, no histórico, no motivo, no rascunho, na finalização e na suspensão
//     (a tentativa na trilha; a quebra de vidro oferecida a quem pode); com vínculo, abre; a primeira leitura vai à
//     trilha dupla como a Consulta do RES;
//   - rascunho importado (ADR 0006): do autor, ele vê, salva, finaliza e descarta; de outro profissional, só leitura;
//   - prova (regra 11): "confere", "alterado" pelo outro sistema depois da gravação e "sem prova";
//   - correção ligada ao original suspenso; suspensão de registro de outro paciente: 404;
//   - sessão "como": a marca do suporte técnico no registro e na suspensão;
//   - profissional com dois CBO: suspende e continua o rascunho com o CBO do registro;
//   - modelo fora da liberação (conferência abaixo da meta; o componente de alergia não desliga: D-ALE-2): desligado com o motivo;
//   - a representação em cache separada por rede.
import {
  type CampoRegistro,
  definicaoParametro,
  EVENTOS_AUDITAVEIS,
  lerModelosForaDaLiberacao,
  modeloForaDaLiberacao,
  PARAMETRO_MODELOS_FORA_DA_LIBERACAO,
  PARAMETRO_MODELOS_LIBERADOS,
  type RespostaRegistro,
} from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import type { ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { RegistroClinicoController } from './registro.controller.js';
import { PortaRegistroMemoria } from './registro-porta-memoria.js';
import { motivoDoFormulario, ServicoRegistro } from './registro-servico.js';
import type { LinhaGravacao } from './tipos-pep.js';
import { EstadoProntuario } from './sessao-prontuario.js';
import type { ProfissionalDoRegistro } from './tipos-pep.js';

const PERMISSOES = ['pep.evolucao.ler', 'pep.evolucao.criar', 'pep.evolucao.suspender'];
const C = {
  cliente: 'teste',
  estabelecimento: null,
  usuario: null,
  correlacao: 'teste',
  rede: 'rede-teste',
  hospital: 'aa',
};

const texto = (vinculo: number, t: string): RespostaRegistro => ({
  vinculo,
  valor: {
    tipo: 'formatado',
    paragrafos: [
      {
        alinhamento: 'esquerda',
        recuo: 0,
        trechos: [{ texto: t, negrito: false, italico: false, sublinhado: false, cor: 0 }],
      },
    ],
  },
  autopreenchido: false,
  confirmado: false,
});
const agora = () => new Date(Date.now() - 3 * 3_600_000 - 2 * 60_000).toISOString().slice(0, 16);

let chave = 0;
function montar(
  o: {
    restricao?: boolean;
    permissoes?: string[];
    vinculos?: { login: string; idPaciente: number; forma: 'equipe' }[];
    como?: boolean;
  } = {},
) {
  const t = new RegistradorTrilhaMemoria();
  const porta = new PortaRegistroMemoria(t);
  const servico = new ServicoRegistro(porta);
  const permissoes = o.permissoes ?? PERMISSOES;
  const ctrl = new RegistroClinicoController(
    servico,
    new EstadoProntuario(),
    new PortaCadastroMemoria(),
    {} as ResolvedorSessao,
    null,
    fonteConfiguracaoMemoria(t, {
      chavesIniciais: chavesIniciaisSinteticas,
      prerequisitosIniciais: prerequisitosIniciaisSinteticos,
      // ADR 0002: o produto não traz modelo liberado por padrão; a sessão sintética define a lista.
      parametrosIniciais: parametrosIniciaisSinteticos,
    }),
    null,
    t,
    null,
    new VinculoSintetico(o.vinculos ?? []),
    null,
  );
  const req = () =>
    ({
      headers: { 'idempotency-key': `teste.m22.regras.${chave++}` },
      ip: '127.0.0.1',
      ...(o.como ? { sghComo: { alvoLogin: 'SINT.MEDICO', alvoNome: 'Médico sintético' } } : {}),
      sgh: {
        real: false,
        permissao: 'pep.evolucao.criar',
        ability: criarAbility(regrasDeAcesso(permissoes, null)),
        sessao: {
          usuario: { id: '1', nome: 'Médico sintético', login: 'SINT.MEDICO' },
          rede: C.rede,
          estabelecimentos: [],
          estabelecimentoAtivo: C.hospital,
          unidadeAtiva: null,
          permissoes,
          restricaoVinculo: o.restricao === true,
          sintetica: true,
          bloqueioInatividadeSegundos: 0,
          expiraEm: '',
        },
      },
    }) as unknown as RequisicaoAutorizada;
  return { ctrl, porta, servico, req, t };
}

async function erro(p: Promise<unknown>): Promise<ErroProblema | null> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema) return e;
    throw e;
  }
  return null;
}

/** Finaliza um EVAM sintético pelo controlador e devolve o ID do registro. */
async function finalizarEvam(m: ReturnType<typeof montar>, extra: Record<string, unknown> = {}) {
  const f = await m.ctrl.formulario('1003', '61', {}, m.req());
  const r = await m.ctrl.finalizar(
    '1003',
    {
      modelo: 61,
      atendimento: 10031,
      dataHoraClinica: agora(),
      impressao: f.impressao,
      respostas: [texto(6101, 'Quadro SINTETICO'), texto(6102, 'Exame SINTETICO')],
      ...extra,
    },
    m.req(),
  );
  return r.registro;
}

describe('vínculo assistencial nos registros clínicos (o mesmo do prontuário ao vivo)', () => {
  it('com a restrição e sem vínculo: 403 sem-vinculo em leitura e gravação; a tentativa vai à trilha', async () => {
    const m = montar({ restricao: true });
    const corpo = { modelo: 61, atendimento: 10031, dataHoraClinica: agora(), respostas: [] };
    const respostas = [texto(6101, 'Quadro SINTETICO')];
    const tentativas: (() => Promise<unknown>)[] = [
      () => m.ctrl.modelos('1003', m.req()),
      () => m.ctrl.formulario('1003', '61', {}, m.req()),
      () => m.ctrl.historico('1003', '61', '6103', m.req()),
      () => m.ctrl.motivo('1003', { motivo: 'assistencia' }, m.req()),
      () => m.ctrl.salvarRascunho('1003', corpo, m.req()),
      () => m.ctrl.finalizar('1003', { ...corpo, respostas, impressao: 'a'.repeat(64) }, m.req()),
      () =>
        m.ctrl.suspender('1003', '950000', { senha: 'x', justificativa: 'Justificativa SINTETICA' }, m.req()),
    ];
    for (const p of tentativas) {
      const e = await erro(p());
      expect(e).toMatchObject({ tipo: 'sem-vinculo', extras: { quebraDeVidro: false } });
    }
    expect(
      m.t.eventos.filter(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === 1003,
      ),
    ).toHaveLength(tentativas.length);
    expect(m.t.eventos.every((e) => e.recurso !== 'pep.evolucao' || e.resultado === 'falha')).toBe(true);
  });

  it('o perfil que pode pedir a quebra de vidro recebe a oferta', async () => {
    const m = montar({ restricao: true, permissoes: [...PERMISSOES, 'acesso.emergencia.solicitar'] });
    expect(await erro(m.ctrl.formulario('1003', '61', {}, m.req()))).toMatchObject({
      tipo: 'sem-vinculo',
      extras: { quebraDeVidro: true },
    });
  });

  it('com vínculo, abre; a primeira leitura do paciente vai à trilha dupla (Consulta do RES), uma vez', async () => {
    const m = montar({
      restricao: true,
      vinculos: [{ login: 'SINT.MEDICO', idPaciente: 1003, forma: 'equipe' }],
    });
    const f = await m.ctrl.formulario('1003', '61', {}, m.req());
    expect(f.modelo.codigo).toBe('EVAM');
    await m.ctrl.formulario('1003', '61', {}, m.req());
    const res = m.t.eventos.filter((e) => e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ recurso: 'pep.evolucao', paciente: 1003 });
  });

  it('sem a restrição (como no pc), abre sem vínculo', async () => {
    const m = montar();
    expect((await m.ctrl.formulario('1003', '61', {}, m.req())).modelo.codigo).toBe('EVAM');
  });
});

describe('rascunho importado (ADR 0006, importação é continuidade)', () => {
  it('é rascunho normal do autor: ele o vê sem trava, salva por cima e finaliza; sem aviso de só leitura', async () => {
    const m = montar();
    const prof = (await m.porta.profissional(C, 'SINT.MEDICO'))!;
    // O conteúdo de origem nas linhas do contrato (o que a leitura do importado devolve): de um rascunho descartado.
    const molde = await m.ctrl.salvarRascunho(
      '1003',
      {
        modelo: 61,
        atendimento: 10031,
        dataHoraClinica: agora(),
        respostas: [texto(6102, 'Exame IMPORTADO')],
      },
      m.req(),
    );
    const linhasDeOrigem = (await m.porta.lerRascunho(C, molde.rascunho))!.linhas.map(
      (l) => ({ ...l, procedimento: undefined, observacao: undefined }) as unknown as LinhaGravacao,
    );
    await m.ctrl.descartar(String(molde.rascunho), { versao: molde.versao }, m.req());
    const id = m.porta.semearRascunhoImportado(
      C.hospital,
      { paciente: 1003, modelo: 61, atendimento: 10031, cbo: prof.cbo },
      false,
      { linhas: linhasDeOrigem, lancadoEm: '2025-03-10T09:15:00.000' },
    );
    const f = await m.ctrl.formulario('1003', '61', { rascunho: String(id) }, m.req());
    expect(f.rascunho?.resumo).toMatchObject({ id, somenteLeitura: false, importado: true });
    // O autor vê o que escreveu na origem e o lançamento original (nunca o formulário vazio nem a data da carga).
    expect(JSON.stringify(f.rascunho?.respostas.filter((r) => r.vinculo === 6102))).toContain(
      'Exame IMPORTADO',
    );
    expect(f.rascunho?.resumo.atualizadoEm).toMatch(/^2025-03-10/);
    expect(f.rascunhos.find((r) => r.id === id)).toMatchObject({ somenteLeitura: false });
    expect(f.avisos.join(' ')).not.toMatch(/só leitura/);
    const salvo = await m.ctrl.salvarRascunho(
      '1003',
      {
        modelo: 61,
        atendimento: 10031,
        dataHoraClinica: agora(),
        rascunho: { id, versao: f.rascunho!.resumo.versao },
        respostas: [texto(6102, 'Exame SINTETICO')],
      },
      m.req(),
    );
    // A nova versão é desta casa; a importada fica arquivada (nunca apagada) e sai da lista.
    const f2 = await m.ctrl.formulario('1003', '61', { rascunho: String(salvo.rascunho) }, m.req());
    expect(f2.rascunho?.resumo).toMatchObject({ somenteLeitura: false, importado: false });
    expect(f2.rascunhos.map((r) => r.id)).not.toContain(id);
    const registro = await finalizarEvam(m, { rascunho: { id: salvo.rascunho, versao: salvo.versao } });
    expect(registro).toBeGreaterThan(0);
    expect((await m.ctrl.formulario('1003', '61', {}, m.req())).rascunhos).toEqual([]);
  });

  it('o autor descarta o importado como qualquer rascunho', async () => {
    const m = montar();
    const prof = (await m.porta.profissional(C, 'SINT.MEDICO'))!;
    const id = m.porta.semearRascunhoImportado(C.hospital, {
      paciente: 1003,
      modelo: 61,
      atendimento: 10031,
      cbo: prof.cbo,
    });
    const f = await m.ctrl.formulario('1003', '61', { rascunho: String(id) }, m.req());
    await m.ctrl.descartar(String(id), { versao: f.rascunho!.resumo.versao }, m.req());
    expect((await m.ctrl.formulario('1003', '61', {}, m.req())).rascunhos.map((r) => r.id)).not.toContain(id);
  });

  it('importado de outro profissional: só leitura, e salvar ou descartar sobre ele é recusado', async () => {
    const m = montar();
    const prof = (await m.porta.profissional(C, 'SINT.MEDICO'))!;
    const id = m.porta.semearRascunhoImportado(C.hospital, {
      paciente: 1003,
      modelo: 61,
      atendimento: 10031,
      cbo: prof.cbo + 999,
    });
    const f = await m.ctrl.formulario('1003', '61', { rascunho: String(id) }, m.req());
    expect(f.rascunho?.resumo).toMatchObject({ id, somenteLeitura: true, importado: true });
    expect(f.avisos.join(' ')).toMatch(/outro profissional/);
    const versao = f.rascunho!.resumo.versao;
    const salvar = await erro(
      m.ctrl.salvarRascunho(
        '1003',
        {
          modelo: 61,
          atendimento: 10031,
          dataHoraClinica: agora(),
          rascunho: { id, versao },
          respostas: [texto(6102, 'Exame SINTETICO')],
        },
        m.req(),
      ),
    );
    expect(salvar?.extras).toMatchObject({ codigo: 'rascunho-de-outro' });
    expect(await erro(m.ctrl.descartar(String(id), { versao }, m.req()))).toMatchObject({
      extras: { codigo: 'rascunho-de-outro' },
    });
  });
});

describe('prova, correção, suspensão e a marca do suporte técnico', () => {
  it('prova: confere; alterado pelo outro sistema depois da gravação; registro sem prova', async () => {
    const m = montar();
    const registro = await finalizarEvam(m);
    await m.ctrl.motivo('1003', { motivo: 'assistencia' }, m.req());
    expect((await m.ctrl.visualizar('1003', String(registro), m.req())).prova.situacao).toBe('confere');
    m.porta.alterarForaDoNovo(C.hospital, registro);
    expect((await m.ctrl.visualizar('1003', String(registro), m.req())).prova.situacao).toBe('alterado');
    const prof = (await m.porta.profissional(C, 'SINT.MEDICO'))!;
    const outro = m.porta.semearRegistroDoOutroSistema(C.hospital, {
      paciente: 1003,
      modelo: 61,
      atendimento: 10031,
      cbo: prof.cbo,
    });
    expect((await m.ctrl.visualizar('1003', String(outro), m.req())).prova.situacao).toBe('sem-prova');
  });

  it('correção ligada ao original suspenso; sem suspender antes, recusada; registro de outro paciente: 404', async () => {
    const m = montar();
    const original = await finalizarEvam(m);
    const semSuspender = await erro(finalizarEvam(m, { corrige: original }));
    expect(semSuspender?.extras).toMatchObject({ codigo: 'correcao-sem-suspensao' });
    const deOutroPaciente = await erro(
      m.ctrl.suspender(
        '1001',
        String(original),
        { senha: 'x', justificativa: 'Justificativa SINTETICA' },
        m.req(),
      ),
    );
    expect(deOutroPaciente?.getStatus()).toBe(404);
    await m.ctrl.suspender(
      '1003',
      String(original),
      { senha: 'x', justificativa: 'Registro SINTETICO no paciente errado' },
      m.req(),
    );
    await m.ctrl.motivo('1003', { motivo: 'assistencia' }, m.req());
    const suspenso = await m.ctrl.visualizar('1003', String(original), m.req());
    expect(suspenso).toMatchObject({ suspenso: true, podeCorrigir: true, corrige: null });
    const correcao = await finalizarEvam(m, { corrige: original });
    const v = await m.ctrl.visualizar('1003', String(correcao), m.req());
    expect(v).toMatchObject({ corrige: original, podeCorrigir: false, marcas: [] });
  });

  it('sessão "como": a marca do suporte técnico no registro e na suspensão', async () => {
    const m = montar({ como: true });
    const registro = await finalizarEvam(m);
    await m.ctrl.suspender(
      '1003',
      String(registro),
      { senha: 'x', justificativa: 'Registro SINTETICO no paciente errado' },
      m.req(),
    );
    await m.ctrl.motivo('1003', { motivo: 'assistencia' }, m.req());
    const v = await m.ctrl.visualizar('1003', String(registro), m.req());
    expect(v.marcas).toHaveLength(2);
    expect(v.marcas[0]).toMatch(/^Registrado pelo suporte técnico em nome de /);
    expect(v.marcas[1]).toMatch(/^Suspensão: registrado pelo suporte técnico em nome de /);
  });
});

describe('profissional com dois CBO', () => {
  it('suspende e continua o rascunho com o CBO do registro (não o do PEP)', async () => {
    const porta = new PortaRegistroMemoria();
    const servico = new ServicoRegistro(porta);
    const base = (await porta.profissional(C, 'SINT.MEDICO'))!;
    const segundo = base.cbo + 1;
    const prof: ProfissionalDoRegistro = { ...base, cbos: [base.cbo, segundo] };
    const registro = porta.semearRegistroDoOutroSistema(C.hospital, {
      paciente: 1003,
      modelo: 61,
      atendimento: 10031,
      cbo: segundo,
    });
    const s = await servico.montarSuspensao(C, 1003, registro, 'Justificativa SINTETICA', prof);
    expect(s.cbo).toBe(segundo);
    const rascunho = porta.semearRascunhoImportado(
      C.hospital,
      { paciente: 1003, modelo: 61, atendimento: 10031, cbo: segundo },
      true,
    );
    const lido = await porta.lerRascunho(C, rascunho);
    const g = await servico.montarRascunho(
      C,
      {
        paciente: 1003,
        modelo: 61,
        atendimento: 10031,
        dataHoraClinica: agora(),
        rascunho: { id: rascunho, versao: lido!.rascunho.versao },
        respostas: [],
      },
      prof,
      new Set(['EVAM']),
    );
    expect(g.cbo).toBe(segundo);
    // De outro atendimento do mesmo paciente: recusado (o rascunho fica no atendimento dele).
    const outroAtendimento = await erro(
      servico.montarRascunho(
        C,
        {
          paciente: 1003,
          modelo: 61,
          atendimento: 10032,
          dataHoraClinica: agora(),
          rascunho: { id: rascunho, versao: lido!.rascunho.versao },
          respostas: [],
        },
        prof,
        new Set(['EVAM']),
      ),
    );
    expect(outroAtendimento?.extras).toMatchObject({ codigo: 'rascunho-de-outro-atendimento' });
  });
});

describe('liberação por modelo e cache da representação', () => {
  it('fora da liberação: a configuração do cliente, com o motivo; o componente de alergia não desliga (D-ALE-2)', () => {
    const fora = lerModelosForaDaLiberacao(
      'ENF091: Conferência abaixo da meta (84,44%); fisiuti: Abaixo da meta (99,49%); ; X9',
    );
    expect([...fora.keys()]).toEqual(['ENF091', 'FISIUTI', 'X9']);
    expect(modeloForaDaLiberacao('ENF091', fora)).toMatch(/conferência abaixo da meta \(84,44%\)/);
    expect(modeloForaDaLiberacao('fisiuti', fora)).toMatch(/99,49%/);
    expect(modeloForaDaLiberacao('X9', fora)).toMatch(/comissão de prontuário/);
    expect(modeloForaDaLiberacao('EVAM', fora)).toBeNull();
    // ADR 0002: o cliente sem configuração não tem modelo especial (o padrão do produto é vazio).
    expect(modeloForaDaLiberacao('ENF091')).toBeNull();
    expect(
      lerModelosForaDaLiberacao(definicaoParametro(PARAMETRO_MODELOS_FORA_DA_LIBERACAO)?.padrao).size,
    ).toBe(0);
    expect(definicaoParametro(PARAMETRO_MODELOS_LIBERADOS)?.padrao).toBe('');
    const m = {
      id: 1,
      codigo: 'X1',
      nome: null,
      tipoComposicao: 2,
      nomeTipoComposicao: 'Evolução',
      especialidades: [],
      aposentado: false,
      usoRecente: 1,
    };
    const alergia = { tipo: 'alergias', itens: [] } as unknown as CampoRegistro;
    const secao = { tipo: 'secao', itens: [alergia] } as unknown as CampoRegistro;
    expect(motivoDoFormulario(m, [secao])).toBeNull();
    expect(motivoDoFormulario({ ...m, codigo: 'ENF091' }, [secao], fora)).toMatch(/84,44%/);
    expect(motivoDoFormulario({ ...m, codigo: 'ENF091' }, [secao])).toBeNull();
    expect(motivoDoFormulario(m, [])).toBeNull();
  });

  it('o modelo fora da liberação fica desligado mesmo listado no parâmetro', async () => {
    const porta = new PortaRegistroMemoria();
    const servico = new ServicoRegistro(porta);
    const prof = await porta.profissional(C, 'SINT.MEDICO');
    const lista = await servico.modelosParaRegistro(C, prof, new Set(['EVAM', 'M10', 'ENF091']));
    expect(lista.find((x) => x.codigo === 'EVAM')?.situacao).toBe('liberado');
    const fora = await servico.modeloAdmin(C, 61);
    expect(fora).toMatchObject({ situacao: 'liberado', motivo: null });
    // A configuração do cliente põe o M10 fora da liberação: desligado com o motivo, mesmo listado.
    const cfg = lerModelosForaDaLiberacao('M10: Conferência do formulário abaixo da meta.');
    const l2 = await servico.modelosParaRegistro(C, prof, new Set(['EVAM', 'M10']), cfg);
    expect(l2.find((x) => x.codigo === 'M10')).toMatchObject({
      situacao: 'desligado',
      motivo: expect.stringMatching(/conferência do formulário abaixo da meta/),
    });
    expect(l2.find((x) => x.codigo === 'EVAM')?.situacao).toBe('liberado');
    expect(await servico.modeloAdmin(C, 62, cfg)).toMatchObject({ situacao: 'desligado' });
    expect(await servico.modeloAdmin(C, 62)).toMatchObject({ situacao: 'liberado' });
  });

  it('a representação em cache é separada por rede (o mesmo estabelecimento, modelo e selo)', async () => {
    let lidas = 0;
    class Contadora extends PortaRegistroMemoria {
      override async definicao(c: Parameters<PortaRegistroMemoria['definicao']>[0], modelo: number) {
        lidas++;
        return super.definicao(c, modelo);
      }
    }
    const servico = new ServicoRegistro(new Contadora());
    await servico.representacao(
      {
        cliente: 'teste',
        estabelecimento: null,
        usuario: null,
        correlacao: 'teste',
        rede: 'r1',
        hospital: 'aa',
      },
      61,
    );
    await servico.representacao(
      {
        cliente: 'teste',
        estabelecimento: null,
        usuario: null,
        correlacao: 'teste',
        rede: 'r1',
        hospital: 'aa',
      },
      61,
    );
    await servico.representacao(
      {
        cliente: 'teste',
        estabelecimento: null,
        usuario: null,
        correlacao: 'teste',
        rede: 'r2',
        hospital: 'aa',
      },
      61,
    );
    expect(lidas).toBe(2);
  });
});
