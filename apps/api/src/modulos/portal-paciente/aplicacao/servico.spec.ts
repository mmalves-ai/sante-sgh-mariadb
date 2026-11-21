// Serviço do portal do paciente (M50, etapa 1) sobre a porta EM MEMÓRIA e um relógio controlado: o procurador (escopo
// marcado na conferência, validade obrigatória e máxima, revogado pelo titular), a segregação (quem pediu não decide), a
// recusa e o motivo que o responsável vê, o job da vigência (maioridade, validade, óbito e a conta encerrada), o desbloqueio
// que refaz o acesso com um convite novo, o encerramento que leva os vínculos junto, o convite vencido e esgotado, o
// segundo fator com tentativas e o portal desligado. Pacientes SINTÉTICOS.
import { codigoTotp } from '@sgh/dominio-acesso';
import type { RegistroTrilhaPortal } from '../tipos.js';
import { describe, expect, it } from 'vitest';
import { PortaGestaoMemoria } from '../../qualidade/public-api.js';
import { PortaPortalMemoria } from '../porta-memoria.js';
import { CanalHalai, CanalSimulador, canalDoAmbiente } from './canal.js';
import { ArmazemProvasMemoria } from './provas.js';
import { type QuemInterno, ServicoPortalPaciente } from './servico.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40, 2)]);
const csrfDe = (a: { csrf: string }) => ({ cookie: a.csrf, cabecalho: a.csrf });

function montar(inicio = '2026-10-24T12:00:00.000Z') {
  let agora = new Date(inicio);
  const porta = new PortaPortalMemoria(null, () => agora);
  const s = new ServicoPortalPaciente(
    porta,
    null,
    null,
    new ArmazemProvasMemoria(),
    { rede: 'r', produto: 'Produto de teste', chaveMestra: Buffer.alloc(32, 9), estabelecimentoPadrao: 'aa' },
    null,
    () => agora,
  );
  const q = (login: string): QuemInterno => ({
    rede: 'r',
    hospital: 'aa',
    login,
    estacao: 'teste',
    correlacao: 'c',
    origem: null,
  });
  let ip = 0;
  async function conta(paciente: number, nascimento: string, email: string) {
    const c = await s.convidar(q('SINT.RECEPCAO'), { idPaciente: paciente, origem: 'recepcao' });
    const a = await s.conferirConvite(
      'aa',
      { codigo: c.codigo.replace(/-/g, ''), nascimento },
      `10.0.0.${++ip}`,
    );
    const ini = await s.iniciarAtivacao(a.id, csrfDe(a), {
      codigo: c.codigo,
      nascimento,
      email,
      senha: 'frase-sintetica-longa',
      confirmacao: 'frase-sintetica-longa',
      termoUso: '2026.1',
      politicaPrivacidade: '2026.1',
    });
    const segredo = new URL(ini.otpauth).searchParams.get('secret') ?? '';
    const r = await s.confirmarSegundoFator(a.id, csrfDe(a), {
      codigo: codigoTotp(segredo, agora.getTime()),
    });
    return { id: r.id, csrf: r.csrf, segredo, conta: c.conta };
  }
  return {
    s,
    porta,
    q,
    conta,
    avancar: (dias: number) => {
      agora = new Date(agora.getTime() + dias * 86_400_000);
    },
    agora: () => agora,
  };
}

describe('procurador, segregação e recusa', () => {
  it('o procurador começa sem escopo; a conferência marca o que a procuração permite; o titular revoga', async () => {
    const m = montar();
    const titular = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const proc = await m.conta(1003, '1990-07-01', 'cinthya@portal.test');
    const np = await m.s.sessao(proc.id);
    // Cada recusa consome o arquivo enviado: a tentativa seguinte pede um envio novo.
    const up = async () => (await m.s.enviarProva(np, 'image/png', PNG)).arquivo;
    const base = {
      prontuario: 501001,
      nascimento: '1958-03-12',
      tipo: 'procurador' as const,
      prova: 'procuracao' as const,
    };
    const a1 = await up();
    await expect(
      m.s.pedirVinculo(np, { ...base, arquivo: a1, validade: null }, '10.9.9.9'),
    ).rejects.toMatchObject({
      extras: { codigo: 'validade-obrigatoria' },
    });
    await expect(
      m.s.pedirVinculo(np, { ...base, arquivo: a1, validade: '2027-06-30' }, '10.9.9.9'),
    ).rejects.toMatchObject({ extras: { codigo: 'arquivo-ausente' } });
    await expect(
      m.s.pedirVinculo(np, { ...base, arquivo: await up(), validade: '2028-12-31' }, '10.9.9.9'),
    ).rejects.toMatchObject({
      extras: { codigo: 'validade-longa' },
    });
    const v = await m.s.pedirVinculo(
      np,
      { ...base, arquivo: await up(), validade: '2027-06-30' },
      '10.9.9.9',
    );
    // Pendente: o nome do titular não volta a quem pediu (o pedido não confirma o cadastro de outra pessoa).
    expect(v.primeiroNomeOutro).toBe('');
    expect(v).toMatchObject({ situacao: 'pendente', escopos: [], terminaEm: '2027-07-01' });
    const priv = m.q('SINT.PRIVACIDADE');
    // Quem pediu não decide (a conta do próprio responsável).
    await expect(
      m.s.decidir(m.q(`SGH.PORTAL.C${proc.conta}`), {
        decisao: 'aprovar',
        vinculo: v.vinculo,
        escopos: ['documentos'],
        validade: null,
      }),
    ).rejects.toMatchObject({ extras: { codigo: 'quem-pediu-nao-decide' } });
    await expect(
      m.s.decidir(priv, { decisao: 'aprovar', vinculo: v.vinculo, escopos: [], validade: null }),
    ).rejects.toMatchObject({
      extras: { codigo: 'procurador-sem-escopo' },
    });
    const ok = await m.s.decidir(priv, {
      decisao: 'aprovar',
      vinculo: v.vinculo,
      escopos: ['pedidos', 'documentos'],
      validade: null,
    });
    expect(ok).toMatchObject({
      situacao: 'ativo',
      escopos: ['documentos', 'pedidos'],
      canal: 'portal',
      temArquivo: true,
      guardiao: null,
    });
    // O procurador vê o titular só no escopo: documentos sim, consentimentos não.
    const np2 = await m.s.escolherTitular(await m.s.sessao(proc.id), v.vinculo);
    expect(np2.ativo).toMatchObject({ primeiroNome: 'José', escopos: ['documentos', 'pedidos'] });
    await expect(m.s.consentimentos(await m.s.sessao(proc.id))).rejects.toMatchObject({ status: 403 });
    // O titular vê quem tem acesso e revoga o procurador.
    const nt = await m.s.sessao(titular.id);
    const deMim = (await m.s.vinculos(nt)).deMim;
    expect(deMim).toEqual([expect.objectContaining({ vinculo: v.vinculo, primeiroNomeOutro: 'Cinthya' })]);
    await m.s.revogarVinculo(nt, Number(v.vinculo));
    expect((await m.s.vinculos(await m.s.sessao(proc.id))).meus[0]).toMatchObject({
      situacao: 'encerrado',
      motivoFim: 'revogado-pelo-titular',
    });
    expect((await m.s.sessao(proc.id)).titulares).toHaveLength(1);
  });

  it('a recusa com o motivo que o responsável vê; o pedido repetido; para si mesmo', async () => {
    const m = montar();
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    const n = await m.s.sessao(mae.id);
    const up = async () =>
      (await m.s.enviarProva(n, 'application/pdf', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(40)])))
        .arquivo;
    await expect(
      m.s.pedirVinculo(
        n,
        {
          prontuario: 501003,
          nascimento: '1990-07-01',
          tipo: 'curador',
          prova: 'termo-curatela',
          arquivo: await up(),
          validade: null,
        },
        '10.9.9.9',
      ),
    ).rejects.toMatchObject({ extras: { codigo: 'para-si-mesmo' } });
    const v = await m.s.pedirVinculo(
      n,
      {
        prontuario: 501005,
        nascimento: '2016-05-10',
        tipo: 'pai-mae',
        prova: 'documento-com-filiacao',
        arquivo: await up(),
        validade: null,
      },
      '10.9.9.9',
    );
    await expect(
      m.s.pedirVinculo(
        n,
        {
          prontuario: 501005,
          nascimento: '2016-05-10',
          tipo: 'pai-mae',
          prova: 'certidao-nascimento',
          arquivo: await up(),
          validade: null,
        },
        '10.9.9.9',
      ),
    ).rejects.toMatchObject({ extras: { codigo: 'repetido' } });
    await m.s.decidir(m.q('SINT.PRIVACIDADE'), {
      decisao: 'recusar',
      vinculo: v.vinculo,
      motivo: 'A foto do documento está ilegível.',
    });
    const r = await m.s.vinculos(await m.s.sessao(mae.id));
    expect(r.meus[0]).toMatchObject({ situacao: 'recusado' });
    expect(r.recusa).toBe('A foto do documento está ilegível.');
    expect(r.meus[0]?.primeiroNomeOutro).toBe('');
    expect((await m.s.fila(m.q('SINT.PRIVACIDADE'), { situacao: 'recusado' })).itens[0]).toMatchObject({
      motivoRecusa: 'A foto do documento está ilegível.',
    });
  });
});

describe('job da vigência', () => {
  it('maioridade encerra o vínculo de pai e mãe; procuração vencida; o titular com óbito leva a conta', async () => {
    const m = montar('2034-05-01T12:00:00.000Z');
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    const n = await m.s.sessao(mae.id);
    const { arquivo } = await m.s.enviarProva(n, 'image/png', PNG);
    const v = await m.s.pedirVinculo(
      n,
      {
        prontuario: 501005,
        nascimento: '2016-05-10',
        tipo: 'pai-mae',
        prova: 'certidao-nascimento',
        arquivo,
        validade: null,
      },
      '10.9.9.9',
    );
    expect(v.terminaEm).toBe('2034-05-10');
    await m.s.decidir(m.q('SINT.PRIVACIDADE'), {
      decisao: 'aprovar',
      vinculo: v.vinculo,
      escopos: ['documentos'],
      validade: null,
    });
    expect(await m.s.varrerVigencias('aa')).toEqual({ vinculos: 0, contas: 0 });
    m.avancar(10);
    // A sessão venceu: entra de novo. Na maioridade a sessão já não mostra o filho (vigência a cada pedido) e o job encerra.
    const e = await m.s.entrar(
      'aa',
      {
        email: 'mae@portal.test',
        senha: 'frase-sintetica-longa',
        codigo: codigoTotp(mae.segredo, m.agora().getTime()),
      },
      '10.9.9.9',
    );
    expect(e.sessao.titulares).toHaveLength(1);
    expect(await m.s.varrerVigencias('aa')).toEqual({ vinculos: 1, contas: 0 });
    expect((await m.s.vinculos(await m.s.sessao(e.id))).meus[0]).toMatchObject({
      situacao: 'encerrado',
      motivoFim: 'maioridade',
    });
    // Idempotente.
    expect(await m.s.varrerVigencias('aa')).toEqual({ vinculos: 0, contas: 0 });
  });

  it('a conta do paciente com óbito é encerrada pelo job; o convite para quem tem óbito é recusado', async () => {
    const m = montar();
    await expect(
      m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1007, origem: 'recepcao' }),
    ).rejects.toMatchObject({
      extras: { codigo: 'obito' },
    });
    // A conta criada antes do óbito (simulada direto na porta) é encerrada com o motivo.
    await m.porta.gravar(
      { rede: 'r', hospital: 'aa' },
      (g) =>
        g.criarConta({
          tipo: 'paciente',
          paciente: 1007,
          prontuario: 501007,
          nome: null,
          nascimento: null,
          conviteResumo: 'f'.repeat(64),
          conviteValidoAte: new Date(Date.now() + 3_600_000),
          origem: 'recepcao',
          por: 'SINT.RECEPCAO',
        }),
      null,
    );
    expect(await m.s.varrerVigencias('aa')).toEqual({ vinculos: 0, contas: 1 });
    expect(await m.s.contaDoPaciente(m.q('SINT.RECEPCAO'), 1007)).toMatchObject({
      situacao: 'encerrada',
      motivo: 'obito',
    });
  });
});

describe('lado interno: refazer o acesso, encerrar e convite', () => {
  it('desbloquear refazendo o acesso emite um convite novo; o antigo segredo para de valer; encerrar leva os vínculos', async () => {
    const m = montar();
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    const n = await m.s.sessao(mae.id);
    const { arquivo } = await m.s.enviarProva(n, 'image/png', PNG);
    const v = await m.s.pedirVinculo(
      n,
      {
        prontuario: 501005,
        nascimento: '2016-05-10',
        tipo: 'pai-mae',
        prova: 'certidao-nascimento',
        arquivo,
        validade: null,
      },
      '10.9.9.9',
    );
    const priv = m.q('SINT.PRIVACIDADE');
    await expect(
      m.s.desbloquear(priv, {
        conta: mae.conta,
        justificativa: 'sem bloqueio para desfazer',
        refazerSegundoFator: false,
      }),
    ).rejects.toMatchObject({
      extras: { codigo: 'nao-bloqueada' },
    });
    const r = await m.s.desbloquear(priv, {
      conta: mae.conta,
      justificativa: 'celular perdido pela paciente',
      refazerSegundoFator: true,
    });
    expect(r.conta).toMatchObject({ situacao: 'convidada', segundoFator: false });
    expect(r.convite?.codigo).toMatch(/-/);
    await expect(m.s.sessao(mae.id)).rejects.toMatchObject({ status: 401 });
    await expect(
      m.s.entrar(
        'aa',
        {
          email: 'mae@portal.test',
          senha: 'frase-sintetica-longa',
          codigo: codigoTotp(mae.segredo, m.agora().getTime()),
        },
        '10.1.1.1',
      ),
    ).rejects.toMatchObject({ status: 401 });
    const fim = await m.s.encerrar(priv, {
      conta: mae.conta,
      motivo: 'pedido-do-titular',
      justificativa: 'a paciente pediu o encerramento',
    });
    expect(fim).toMatchObject({ situacao: 'encerrada', motivo: 'pedido-do-titular' });
    expect(
      (await m.s.fila(priv, { situacao: null })).itens.find((x) => x.vinculo === v.vinculo),
    ).toMatchObject({
      situacao: 'encerrado',
    });
    await expect(
      m.s.encerrar(priv, { conta: mae.conta, motivo: 'obito', justificativa: 'repetido para o teste' }),
    ).rejects.toMatchObject({
      extras: { codigo: 'encerrada' },
    });
    // Depois de encerrada, a recepção emite um convite novo (conta nova).
    const novo = await m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1003, origem: 'atendimento' });
    expect(novo.conta).not.toBe(mae.conta);
  });

  it('convite vencido e esgotado, segundo fator com tentativas, conta ativa não recebe outro convite, portal desligado', async () => {
    const m = montar();
    const c = await m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1001, origem: 'recepcao' });
    // Reemitir troca o código (o anterior deixa de valer).
    const c2 = await m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1001, origem: 'recepcao' });
    expect(c2.conta).toBe(c.conta);
    await expect(
      m.s.conferirConvite('aa', { codigo: c.codigo, nascimento: '1958-03-12' }, '10.2.0.1'),
    ).rejects.toMatchObject({ status: 401 });
    for (let i = 0; i < 5; i++)
      await expect(
        m.s.conferirConvite('aa', { codigo: c2.codigo, nascimento: '1958-03-13' }, `10.2.1.${i}`),
      ).rejects.toMatchObject({ status: 401 });
    // Esgotado: nem a data certa passa.
    await expect(
      m.s.conferirConvite('aa', { codigo: c2.codigo, nascimento: '1958-03-12' }, '10.2.2.1'),
    ).rejects.toMatchObject({ status: 401 });
    const c3 = await m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1001, origem: 'recepcao' });
    m.avancar(4);
    await expect(
      m.s.conferirConvite('aa', { codigo: c3.codigo, nascimento: '1958-03-12' }, '10.2.3.1'),
    ).rejects.toMatchObject({ status: 401 });
    const c4 = await m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1001, origem: 'recepcao' });
    const a = await m.s.conferirConvite('aa', { codigo: c4.codigo, nascimento: '1958-03-12' }, '10.2.4.1');
    await expect(m.s.confirmarSegundoFator(a.id, csrfDe(a), { codigo: '123456' })).rejects.toMatchObject({
      status: 401,
    });
    const dados = {
      codigo: c4.codigo,
      nascimento: '1958-03-12',
      email: 'jose@portal.test',
      senha: 'jose@portal.test-jose',
      confirmacao: 'jose@portal.test-jose',
      termoUso: '2026.1',
      politicaPrivacidade: '2026.1',
    };
    await expect(m.s.iniciarAtivacao(a.id, csrfDe(a), dados)).rejects.toMatchObject({ status: 400 });
    const ini = await m.s.iniciarAtivacao(a.id, csrfDe(a), {
      ...dados,
      senha: 'frase-longa-boa',
      confirmacao: 'frase-longa-boa',
    });
    for (let i = 0; i < 5; i++)
      await expect(m.s.confirmarSegundoFator(a.id, csrfDe(a), { codigo: '000000' })).rejects.toMatchObject({
        status: 401,
      });
    // Cinco erradas encerram o primeiro acesso.
    const segredo = new URL(ini.otpauth).searchParams.get('secret') ?? '';
    await expect(
      m.s.confirmarSegundoFator(a.id, csrfDe(a), { codigo: codigoTotp(segredo, m.agora().getTime()) }),
    ).rejects.toMatchObject({ status: 401 });
    const ok = await m.conta(1003, '1990-07-01', 'cinthya@portal.test');
    await expect(
      m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1003, origem: 'recepcao' }),
    ).rejects.toMatchObject({
      extras: { codigo: 'conta-ja-ativa' },
    });
    expect(ok.id).toBeTruthy();
    // O mesmo e-mail em outra conta: recusado sem dizer de quem é.
    const outra = await m.s.convidar(m.q('SINT.RECEPCAO'), { idPaciente: 1001, origem: 'recepcao' });
    const b = await m.s.conferirConvite('aa', { codigo: outra.codigo, nascimento: '1958-03-12' }, '10.2.5.1');
    await expect(
      m.s.iniciarAtivacao(b.id, csrfDe(b), {
        ...dados,
        codigo: outra.codigo,
        email: 'cinthya@portal.test',
        senha: 'frase-longa-boa',
        confirmacao: 'frase-longa-boa',
      }),
    ).rejects.toMatchObject({ extras: { codigo: 'email-em-uso' } });
  });

  it('o portal desligado (fonte de configuração sem a chave) recusa a entrada e o convite', async () => {
    const porta = new PortaPortalMemoria();
    const fonte = {
      chaves: async () => [],
      prerequisitos: async () => [],
      valoresParametro: async () => [],
    } as unknown as ConstructorParameters<typeof ServicoPortalPaciente>[2];
    const s = new ServicoPortalPaciente(porta, null, fonte, new ArmazemProvasMemoria(), {
      rede: 'r',
      produto: 'p',
      chaveMestra: null,
      estabelecimentoPadrao: null,
    });
    expect(await s.ligado('aa')).toBe(false);
    await expect(
      s.entrar('aa', { email: 'a@portal.test', senha: 'x', codigo: '123456' }, '1.1.1.1'),
    ).rejects.toMatchObject({
      extras: { codigo: 'recurso-desligado' },
    });
    await expect(
      s.convidar(
        { rede: 'r', hospital: 'aa', login: 'U', estacao: 'e', correlacao: 'c', origem: null },
        { idPaciente: 1001, origem: 'recepcao' },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await s.varrerVigencias('aa')).toEqual({ vinculos: 0, contas: 0 });
    // O temporizador do job (liga uma vez; desliga).
    s.iniciarVigia(60_000);
    s.iniciarVigia(60_000);
    s.pararVigia();
  });
});

describe('correções da revisão do M50.1', () => {
  const ctx = { rede: 'r', hospital: 'aa' };
  const novoVinculo = (conta: number, i: number) => ({
    conta,
    titular: 1005,
    prontuarioTitular: 501005,
    tipo: 'pai-mae',
    prova: 'certidao-nascimento',
    arquivoChave: null,
    arquivoHash: null,
    validade: null,
    escopos: ['documentos'],
    canal: 'balcao' as const,
    por: `SINT.BALCAO.${i}`,
    decididoPor: `SINT.CONFERE.${i}`,
  });

  it('a decisão responde o vínculo decidido mesmo com a fila maior que uma página; a fila pagina pelo cursor', async () => {
    const m = montar();
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    // 60 vínculos antigos (mais que uma página de 50) e, por último, o pedido pendente.
    for (let i = 0; i < 60; i++)
      await m.porta.gravar(ctx, (g) => g.pedirVinculo(novoVinculo(Number(mae.conta), i)), null);
    const n = await m.s.sessao(mae.id);
    const { arquivo } = await m.s.enviarProva(n, 'image/png', PNG);
    const v = await m.s.pedirVinculo(
      n,
      {
        prontuario: 501001,
        nascimento: '1958-03-12',
        tipo: 'procurador',
        prova: 'procuracao',
        arquivo,
        validade: '2027-06-30',
      },
      '10.9.9.9',
    );
    const priv = m.q('SINT.PRIVACIDADE');
    const r = await m.s.decidir(priv, {
      decisao: 'aprovar',
      vinculo: v.vinculo,
      escopos: ['documentos'],
      validade: null,
    });
    expect(r).toMatchObject({ vinculo: v.vinculo, situacao: 'ativo', primeiroNomeOutro: 'José' });
    // A fila: 50 por página, por ordem de chegada; a página seguinte pelo cursor; a busca pelo prontuário.
    const p1 = await m.s.fila(priv, { situacao: null });
    expect(p1.itens).toHaveLength(50);
    expect(p1.proximo).toBe(p1.itens.at(-1)?.vinculo);
    const p2 = await m.s.fila(priv, { situacao: null, depoisDe: Number(p1.proximo) });
    expect(p2.itens).toHaveLength(11);
    expect(p2.proximo).toBeNull();
    expect(p2.itens.at(-1)?.vinculo).toBe(v.vinculo);
    expect(new Set([...p1.itens, ...p2.itens].map((x) => x.vinculo)).size).toBe(61);
    const busca = await m.s.fila(priv, { situacao: 'ativo', prontuario: 501001 });
    expect(busca.itens.map((x) => x.vinculo)).toEqual([v.vinculo]);
    expect((await m.s.fila(priv, { situacao: null, prontuario: 999999 })).itens).toEqual([]);
    // Na ficha do paciente: os vigentes do titular (o encerramento sai daqui).
    expect((await m.s.responsaveisDoPaciente(priv, 1001)).map((x) => x.vinculo)).toEqual([v.vinculo]);
    await m.s.encerrarVinculo(priv, {
      vinculo: v.vinculo,
      motivo: 'revogado-pelo-hospital',
      justificativa: 'perda da representação, teste sintético',
    });
    expect(await m.s.responsaveisDoPaciente(priv, 1001)).toEqual([]);
  });

  it('o pedido de vínculo não serve de busca de cadastro: recusas contadas por conta, 429, arquivo consumido e trilha', async () => {
    const m = montar();
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    const linhas: RegistroTrilhaPortal[] = [];
    const gravar = m.porta.gravar.bind(m.porta);
    m.porta.gravar = (async (c, fn, t) => {
      const r = await gravar(c, fn, t);
      const l = typeof t === 'function' ? t(r) : t;
      if (l) linhas.push(l);
      return r;
    }) as typeof m.porta.gravar;
    const n = await m.s.sessao(mae.id);
    const up = async () => (await m.s.enviarProva(n, 'image/png', PNG)).arquivo;
    const errado = async (arquivo: string) =>
      m.s.pedirVinculo(
        n,
        {
          prontuario: 501005,
          nascimento: '2016-05-11',
          tipo: 'pai-mae',
          prova: 'certidao-nascimento',
          arquivo,
          validade: null,
        },
        '10.9.9.9',
      );
    for (let i = 0; i < 5; i++)
      await expect(errado(await up())).rejects.toMatchObject({ extras: { codigo: 'titular-inativo' } });
    const falhas = linhas.filter((l) => l.evento === 'portal.vinculo.pedido');
    expect(falhas).toHaveLength(5);
    expect(falhas.every((l) => l.resultado === 'falha' && !l.idPaciente)).toBe(true);
    // A sexta tentativa (mesmo com o par certo) fica bloqueada por uma hora.
    const certo = {
      prontuario: 501005,
      nascimento: '2016-05-10',
      tipo: 'pai-mae' as const,
      prova: 'certidao-nascimento' as const,
      validade: null,
    };
    await expect(m.s.pedirVinculo(n, { ...certo, arquivo: await up() }, '10.9.9.9')).rejects.toMatchObject({
      status: 429,
    });
    // Uma hora depois (a sessão expirou: entra de novo), o pedido certo volta a ser aceito.
    m.avancar(61 / 1440);
    const e = await m.s.entrar(
      'aa',
      {
        email: 'mae@portal.test',
        senha: 'frase-sintetica-longa',
        codigo: codigoTotp(mae.segredo, m.agora().getTime()),
      },
      '10.9.9.8',
    );
    const n2 = await m.s.sessao(e.id);
    const arquivo = (await m.s.enviarProva(n2, 'image/png', PNG)).arquivo;
    const ok = await m.s.pedirVinculo(n2, { ...certo, arquivo }, '10.9.9.9');
    expect(ok).toMatchObject({ situacao: 'pendente', primeiroNomeOutro: '' });
  });

  it('o limite de taxa por origem também vale no pedido de vínculo', async () => {
    const m = montar();
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    const n = await m.s.sessao(mae.id);
    let ultimo: unknown = null;
    for (let i = 0; i < 11; i++)
      ultimo = await m.s
        .pedirVinculo(
          n,
          {
            prontuario: 501005,
            nascimento: '2016-05-10',
            tipo: 'pai-mae',
            prova: 'certidao-nascimento',
            arquivo: 'x',
            validade: null,
          },
          '10.7.7.7',
        )
        .catch((x: unknown) => x);
    expect(ultimo).toMatchObject({ status: 429 });
  });

  it('o código do autenticador vale uma vez (entrada e troca da senha); a senha nova derruba as outras sessões', async () => {
    const m = montar();
    const mae = await m.conta(1003, '1990-07-01', 'mae@portal.test');
    const entrar = (ip: string, senha = 'frase-sintetica-longa') =>
      m.s.entrar(
        'aa',
        { email: 'mae@portal.test', senha, codigo: codigoTotp(mae.segredo, m.agora().getTime()) },
        ip,
      );
    // O código da ativação não vale na entrada.
    await expect(entrar('10.2.0.1')).rejects.toMatchObject({ status: 401 });
    m.avancar(30 / 86_400);
    const outra = await entrar('10.2.0.2');
    // O mesmo código, de novo (replay): a resposta genérica.
    await expect(entrar('10.2.0.3')).rejects.toMatchObject({
      status: 401,
      extras: { codigo: 'credencial-invalida' },
    });
    m.avancar(30 / 86_400);
    const n = await m.s.sessao(mae.id);
    await m.s.trocarSenha(n, {
      atual: 'frase-sintetica-longa',
      nova: 'outra-frase-sintetica',
      confirmacao: 'outra-frase-sintetica',
      codigo: codigoTotp(mae.segredo, m.agora().getTime()),
    });
    // A sessão que trocou continua; a outra cai.
    await expect(m.s.sessao(mae.id)).resolves.toBeTruthy();
    await expect(m.s.sessao(outra.id)).rejects.toMatchObject({ status: 401 });
    // O código usado na troca não vale na entrada.
    await expect(entrar('10.2.0.4', 'outra-frase-sintetica')).rejects.toMatchObject({ status: 401 });
  });
});

describe('W0-10: troca do e-mail e do autenticador', () => {
  const SENHA = 'frase-sintetica-longa';
  /** A trilha de cada gravação (a porta em memória não guarda a trilha das contas). */
  function comTrilha(m: ReturnType<typeof montar>): RegistroTrilhaPortal[] {
    const linhas: RegistroTrilhaPortal[] = [];
    const orig = m.porta.gravar.bind(m.porta);
    m.porta.gravar = async (c, fn, t) => {
      const r = await orig(c, fn, t);
      const l = typeof t === 'function' ? t(r) : t;
      if (l) linhas.push(l);
      return r;
    };
    return linhas;
  }
  const passo = (m: ReturnType<typeof montar>) => m.avancar(30 / 86_400);
  const tokenDe = (link: string) => new URL(link, 'https://x.test').searchParams.get('t') ?? '';

  it('o paciente pede a troca, o link vai ao e-mail novo (simulador), a conta só muda com a confirmação', async () => {
    const m = montar();
    const trilha = comTrilha(m);
    const caixa = m.s.canal as CanalSimulador;
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    await m.conta(1003, '1990-07-01', 'cinthya@portal.test');
    passo(m);
    const n = await m.s.sessao(jose.id);
    const cod = () => codigoTotp(jose.segredo, m.agora().getTime());
    await expect(
      m.s.pedirTrocaEmail(n, { email: 'novo@portal.test', senha: 'errada', codigo: cod() }),
    ).rejects.toMatchObject({ status: 401, extras: { codigo: 'dados-nao-conferem' } });
    passo(m);
    // O e-mail de outra conta é recusado já no pedido.
    await expect(
      m.s.pedirTrocaEmail(n, { email: 'cinthya@portal.test', senha: SENHA, codigo: cod() }),
    ).rejects.toMatchObject({ status: 409, extras: { codigo: 'email-em-uso' } });
    passo(m);
    const r = await m.s.pedirTrocaEmail(n, { email: 'novo@portal.test', senha: SENHA, codigo: cod() });
    expect(r).toMatchObject({ envio: 'simulador', origem: 'portal' });
    const [msg] = caixa.mensagens('aa', Number(jose.conta));
    expect(msg).toMatchObject({ tipo: 'confirmacao-email', destino: 'novo@portal.test' });
    expect((await m.s.seguranca(await m.s.sessao(jose.id))).trocaEmail).toMatchObject({ origem: 'portal' });
    // Antes da confirmação, a conta segue com o e-mail antigo.
    expect((await m.porta.conta({ rede: 'r', hospital: 'aa' }, Number(jose.conta)))?.email).toBe(
      'jose@portal.test',
    );
    await m.s.confirmarTrocaEmail('aa', { token: tokenDe(msg!.link) }, '10.3.0.1');
    const k = await m.porta.conta({ rede: 'r', hospital: 'aa' }, Number(jose.conta));
    expect(k?.email).toBe('novo@portal.test');
    // A sessão aberta cai; o link não vale de novo.
    await expect(m.s.sessao(jose.id)).rejects.toMatchObject({ status: 401 });
    await expect(
      m.s.confirmarTrocaEmail('aa', { token: tokenDe(msg!.link) }, '10.3.0.2'),
    ).rejects.toMatchObject({ status: 410, extras: { codigo: 'link-invalido' } });
    passo(m);
    await expect(
      m.s.entrar('aa', { email: 'novo@portal.test', senha: SENHA, codigo: cod() }, '10.3.0.3'),
    ).resolves.toBeTruthy();
    expect(trilha.map((l) => `${l.evento}|${l.chaveNaturalAlvo}`)).toEqual(
      expect.arrayContaining([
        'portal.email.trocaPedida|portal:pedido-do-titular',
        'portal.email.trocado|confirmada:portal',
      ]),
    );
    // A trilha não leva o e-mail.
    expect(JSON.stringify(trilha)).not.toContain('novo@portal.test');
  });

  it('no balcão: o atendente registra o e-mail novo, cancela; o link cancelado ou vencido não vale', async () => {
    const m = montar();
    const trilha = comTrilha(m);
    const caixa = m.s.canal as CanalSimulador;
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const rec = m.q('SINT.RECEPCAO');
    const base = {
      conta: jose.conta,
      motivo: 'email-perdido' as const,
      justificativa: 'Paciente perdeu o acesso ao e-mail.',
    };
    await m.s.trocarEmailNoBalcao(rec, { ...base, email: 'um@portal.test' });
    const t1 = tokenDe(caixa.mensagens('aa')[0]!.link);
    expect(await m.s.trocaEmailDaConta(rec, jose.conta)).toMatchObject({ origem: 'balcao' });
    // O pedido novo cancela o anterior.
    await m.s.trocarEmailNoBalcao(rec, { ...base, email: 'dois@portal.test' });
    const t2 = tokenDe(caixa.mensagens('aa')[0]!.link);
    await expect(m.s.confirmarTrocaEmail('aa', { token: t1 }, '10.4.0.1')).rejects.toMatchObject({
      status: 410,
    });
    await m.s.cancelarTrocaEmailNoBalcao(rec, jose.conta);
    expect(await m.s.trocaEmailDaConta(rec, jose.conta)).toBeNull();
    await expect(m.s.confirmarTrocaEmail('aa', { token: t2 }, '10.4.0.2')).rejects.toMatchObject({
      status: 410,
    });
    await expect(m.s.cancelarTrocaEmailNoBalcao(rec, jose.conta)).rejects.toMatchObject({ status: 404 });
    // Vencido (24 h por padrão).
    await m.s.trocarEmailNoBalcao(rec, { ...base, email: 'tres@portal.test' });
    const t3 = tokenDe(caixa.mensagens('aa')[0]!.link);
    m.avancar(2);
    await expect(m.s.confirmarTrocaEmail('aa', { token: t3 }, '10.4.0.3')).rejects.toMatchObject({
      status: 410,
    });
    expect(
      trilha
        .filter((l) => l.operacao === 'portal.trocarEmail')
        .map((l) => `${l.usuario}|${l.chaveNaturalAlvo}`),
    ).toEqual([
      'SINT.RECEPCAO|balcao:email-perdido',
      'SINT.RECEPCAO|balcao:email-perdido',
      'SINT.RECEPCAO|cancelada:balcao',
      'SINT.RECEPCAO|balcao:email-perdido',
    ]);
  });

  it('o titular troca o autenticador (senha e código atuais, depois o primeiro código do novo); o antigo para de valer', async () => {
    const m = montar();
    const trilha = comTrilha(m);
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    passo(m);
    const n = await m.s.sessao(jose.id);
    await expect(
      m.s.iniciarTrocaSegundoFator(n, {
        senha: 'errada',
        codigo: codigoTotp(jose.segredo, m.agora().getTime()),
      }),
    ).rejects.toMatchObject({ status: 401 });
    passo(m);
    const ini = await m.s.iniciarTrocaSegundoFator(n, {
      senha: SENHA,
      codigo: codigoTotp(jose.segredo, m.agora().getTime()),
    });
    const novo = new URL(ini.otpauth).searchParams.get('secret') ?? '';
    await expect(m.s.confirmarTrocaSegundoFator(n, { codigo: '000000' })).rejects.toMatchObject({
      status: 401,
    });
    await m.s.confirmarTrocaSegundoFator(n, { codigo: codigoTotp(novo, m.agora().getTime()) });
    passo(m);
    await expect(
      m.s.entrar(
        'aa',
        { email: 'jose@portal.test', senha: SENHA, codigo: codigoTotp(jose.segredo, m.agora().getTime()) },
        '10.5.0.1',
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      m.s.entrar(
        'aa',
        { email: 'jose@portal.test', senha: SENHA, codigo: codigoTotp(novo, m.agora().getTime()) },
        '10.5.0.2',
      ),
    ).resolves.toBeTruthy();
    expect(
      trilha.some((l) => l.evento === 'portal.segundoFator.trocado' && l.chaveNaturalAlvo === 'autenticador'),
    ).toBe(true);
    // Sem o passo 1 (ou expirado), o passo 2 é recusado.
    await expect(m.s.confirmarTrocaSegundoFator(n, { codigo: '123456' })).rejects.toMatchObject({
      status: 410,
    });
  });

  it('o atendente redefine o segundo fator: a conta volta a convidada com um convite novo e o motivo na trilha', async () => {
    const m = montar();
    const trilha = comTrilha(m);
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const r = await m.s.redefinirSegundoFator(m.q('SINT.RECEPCAO'), {
      conta: jose.conta,
      motivo: 'aparelho-perdido',
      justificativa: 'Paciente trocou de celular e perdeu o app.',
    });
    expect(r.conta.situacao).toBe('convidada');
    expect(r.convite.codigo).toMatch(/^[2-9A-HJ-NP-Z]{4}-/);
    expect(trilha.at(-1)).toMatchObject({
      evento: 'portal.segundoFator.trocado',
      chaveNaturalAlvo: 'redefinir:aparelho-perdido',
    });
    await expect(m.s.sessao(jose.id)).rejects.toMatchObject({ status: 401 });
    await expect(
      m.s.redefinirSegundoFator(m.q('SINT.RECEPCAO'), {
        conta: jose.conta,
        motivo: 'aparelho-perdido',
        justificativa: 'De novo, sem conta ativa.',
      }),
    ).rejects.toMatchObject({ status: 409, extras: { codigo: 'nao-ativada' } });
  });

  it('trava de saídas: dev e ci só no simulador; fora, a Hal-AI só com a comunicação ligada, endereço local fora de produção e o cliente do dono', async () => {
    const chamadas: unknown[] = [];
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (...a: unknown[]) => {
      chamadas.push(a);
      throw new Error('rede proibida no teste');
    }) as typeof fetch;
    try {
      expect(canalDoAmbiente('dev', null, 'r')).toBeInstanceOf(CanalSimulador);
      expect(canalDoAmbiente('ci', null, 'r')).toBeInstanceOf(CanalSimulador);
      // Homologação sem a configuração: desligado.
      expect((await canalDoAmbiente('homologacao', null, 'r').disponivel('aa')).envio).toBeNull();
      const halai = (ligado: boolean, endereco: string | null, producao: boolean, cliente = false) =>
        new CanalHalai({
          producao,
          estado: async () => ({ ligado, endereco }),
          cliente: cliente ? async () => undefined : null,
        });
      expect(await halai(false, 'http://127.0.0.1:9', false).disponivel('aa')).toMatchObject({ envio: null });
      expect((await halai(true, 'https://api.halai.com.br', false, true).disponivel('aa')).motivo).toMatch(
        /só endereço local/,
      );
      expect((await halai(true, 'https://api.halai.com.br', true).disponivel('aa')).motivo).toMatch(
        /contrato/,
      );
      expect((await halai(true, 'https://api.halai.com.br', true, true).disponivel('aa')).envio).toBe(
        'halai',
      );
      // O serviço com o canal desligado recusa o pedido (503) e nada é gravado.
      const m = montar();
      m.s.canal = halai(false, null, false);
      const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
      await expect(
        m.s.trocarEmailNoBalcao(m.q('SINT.RECEPCAO'), {
          conta: jose.conta,
          email: 'x@portal.test',
          motivo: 'email-errado',
          justificativa: 'E-mail digitado errado na ativação.',
        }),
      ).rejects.toMatchObject({ status: 503, extras: { codigo: 'canal-desligado' } });
      expect(await m.s.trocaEmailDaConta(m.q('SINT.RECEPCAO'), jose.conta)).toBeNull();
      // O simulador nunca usa a rede.
      const sim = new CanalSimulador();
      await sim.enviar({
        rede: 'r',
        hospital: 'aa',
        conta: 1,
        tipo: 'confirmacao-email',
        destino: 'a@b.test',
        link: '/x',
        validoAte: '',
      });
      expect(sim.mensagens('aa')).toHaveLength(1);
      expect(chamadas).toHaveLength(0);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });
});

describe('W0-10: o titular cancela com motivo o pedido não respondido', () => {
  it('cancela o aberto (motivo e quando); o cancelado e o respondido devolvem 409; o de outro titular é 404', async () => {
    const m = montar();
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const n = await m.s.sessao(jose.id);
    const a = await m.s.registrarPedido(n, { tipo: 'acesso', descricao: null });
    const b = await m.s.registrarPedido(n, { tipo: 'correcao', descricao: 'endereço' });
    let lista = await m.s.pedidos(n);
    expect(lista.find((p) => p.protocolo === a.protocolo)).toMatchObject({
      cancelavel: true,
      motivoCancelamento: null,
    });
    await m.s.cancelarPedido(n, a.protocolo, { motivo: 'aberto-por-engano', observacao: null });
    lista = await m.s.pedidos(n);
    expect(lista.find((p) => p.protocolo === a.protocolo)).toMatchObject({
      situacao: 'cancelado',
      motivoCancelamento: 'aberto-por-engano',
      cancelavel: false,
      respondidoEm: m.agora().toISOString(),
      atrasado: false,
    });
    await expect(
      m.s.cancelarPedido(n, a.protocolo, { motivo: 'desistencia', observacao: null }),
    ).rejects.toMatchObject({ status: 409 });
    // O respondido pela área de privacidade (o protocolado) não se altera.
    const [doB] = (await m.porta.pedidos({ rede: 'r', hospital: 'aa' }, Number(jose.conta), 1001)).filter(
      (p) => p.protocolo === b.protocolo,
    );
    Object.assign(doB!, { situacao: 'atendido', decididoEm: m.agora().toISOString() });
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === b.protocolo)?.cancelavel).toBe(false);
    await expect(
      m.s.cancelarPedido(n, b.protocolo, { motivo: 'desistencia', observacao: null }),
    ).rejects.toMatchObject({
      status: 409,
      titulo: 'Pedido protocolado',
      detalhe: expect.stringMatching(/protocolado não se altera/),
    });
    await expect(
      m.s.cancelarPedido(n, '2026-999999', { motivo: 'desistencia', observacao: null }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('W0-10 (M1): ouvidoria pelo portal', () => {
  it('a manifestação vai à ouvidoria com protocolo e prazo; o paciente vê a situação e a resposta; a de outro não', async () => {
    const m = montar();
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const n = await m.s.sessao(jose.id);
    const r = await m.s.registrarManifestacao(n, {
      tipo: 'elogio',
      area: null,
      relato: 'Equipe da enfermagem muito atenciosa.',
    });
    expect(r.protocolo).toMatch(/^OUV-2026-\d{6}$/);
    // Recebida no sábado 24/10 às 9h: o prazo é o fim de um dia útil depois (dez dias úteis, sem contar o sábado).
    expect(r.prazoEm).toMatch(/^2026-11-\d{2}T23:59:59$/);
    let lista = await m.s.manifestacoes(n);
    expect(lista).toEqual([
      {
        protocolo: r.protocolo,
        tipo: 'elogio',
        area: 'geral',
        relato: 'Equipe da enfermagem muito atenciosa.',
        recebidaEm: '2026-10-24T09:00:00',
        prazoEm: r.prazoEm,
        situacao: 'aberta',
        resposta: null,
        respondidaEm: null,
      },
    ]);
    m.porta.responderManifestacao({ rede: 'r', hospital: 'aa' }, r.protocolo, 'Agradecemos o elogio.');
    lista = await m.s.manifestacoes(n);
    expect(lista[0]).toMatchObject({ situacao: 'respondida', resposta: 'Agradecemos o elogio.' });
    // Outra pessoa não vê a manifestação do José.
    const maria = await m.conta(1003, '1990-07-01', 'cinthya@portal.test');
    expect(await m.s.manifestacoes(await m.s.sessao(maria.id))).toEqual([]);
  });

  it('na sessão sintética, a manifestação vai à ouvidoria interna em memória (canal portal) e a resposta de lá volta ao portal', async () => {
    const m = montar();
    const gestao = new PortaGestaoMemoria({ agora: () => new Date('2026-10-24T12:00:00.000Z') });
    m.porta.ouvidoriaInterna = gestao.ouvidoriaDoPortal();
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const n = await m.s.sessao(jose.id);
    const r = await m.s.registrarManifestacao(n, {
      tipo: 'reclamacao',
      area: 'Recepção',
      relato: 'Demora na recepção do pronto-socorro (texto sintético).',
    });
    const cg = { rede: 'r', hospital: 'aa' } as unknown as Parameters<PortaGestaoMemoria['manifestacoes']>[0];
    const internas = await gestao.manifestacoes(cg, { pagina: 1, porPagina: 20 });
    const linha = internas.itens.find((x) => x.protocolo === r.protocolo)!;
    expect(linha).toMatchObject({ canal: 'portal', identificada: true, paciente: 1001, tipo: 'reclamacao' });
    expect(linha.situacao).toBe('aberta');
    await gestao.gravarSgh(cg, null, (g) =>
      g.responderManifestacao({
        id: linha.id,
        versao: linha.versao,
        resposta: 'Reforçamos a escala (texto sintético).',
        procedente: true,
        usuario: 'SINT.OUVIDORIA',
        agora: '2026-10-26T10:00:00',
      } as never),
    );
    expect((await m.s.manifestacoes(n))[0]).toMatchObject({
      protocolo: r.protocolo,
      situacao: 'respondida',
      resposta: 'Reforçamos a escala (texto sintético).',
    });
    // Outra pessoa não vê a manifestação do José.
    const maria = await m.conta(1003, '1990-07-01', 'cinthya@portal.test');
    expect(await m.s.manifestacoes(await m.s.sessao(maria.id))).toEqual([]);
    // Revisão do W0-10: o mesmo número de paciente em outro estabelecimento não vê a manifestação do José do 'aa'.
    expect(await m.porta.manifestacoes({ rede: 'r', hospital: 'bb' }, 1001)).toEqual([]);
    expect((await m.porta.manifestacoes({ rede: 'r', hospital: 'aa' }, 1001))[0]?.protocolo).toBe(
      r.protocolo,
    );
    const ponte = m.porta.ouvidoriaInterna!;
    const outra = await ponte.registrar(
      {
        protocoloDe: (k: number) => `OUV-BB-${k}`,
        tipo: 'elogio',
        paciente: 1001,
        area: 'Enfermagem',
        relato: 'Atendimento atencioso no hospital B (texto sintético).',
        recebidaEm: '2026-10-26T11:00:00',
        prazoEm: '2026-11-25T11:00:00',
        usuario: 'SGH.PORTAL',
      } as never,
      'bb',
    );
    expect((await ponte.doPaciente(1001, 'bb')).map((x) => x.protocolo)).toEqual([outra.protocolo]);
    expect((await ponte.doPaciente(1001, 'aa')).map((x) => x.protocolo)).toEqual([r.protocolo]);
  });

  it('o relato curto é recusado pelo contrato', async () => {
    const { esquemaManifestacaoPortal } = await import('@sgh/contratos');
    expect(esquemaManifestacaoPortal.safeParse({ tipo: 'reclamacao', relato: 'ruim' }).success).toBe(false);
    expect(esquemaManifestacaoPortal.safeParse({ tipo: 'denuncia', relato: 'x'.repeat(20) }).success).toBe(
      false,
    );
    expect(esquemaManifestacaoPortal.parse({ tipo: 'sugestao', relato: 'Mais cadeiras na espera.' })).toEqual(
      {
        tipo: 'sugestao',
        area: null,
        relato: 'Mais cadeiras na espera.',
      },
    );
  });
});

describe('W0-10 (M2): cópia do prontuário', () => {
  it('o titular pede pelo portal; o balcão confere, gera o PDF com marca e entrega; o titular baixa o mesmo arquivo', async () => {
    const m = montar();
    m.s.prontuarioCopia = async () => [
      { titulo: 'Registros do prontuário', linhas: ['2026-10-01 · Evolução: estável'] },
    ];
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const n = await m.s.sessao(jose.id);
    const r = await m.s.pedirCopia(n, { observacao: null });
    expect(r.protocolo).toMatch(/^2026-\d{6}$/);
    expect(r.prazo).toBe('2026-11-08T12:00:00.000Z');
    expect(await m.s.copias(n)).toEqual([
      expect.objectContaining({
        protocolo: r.protocolo,
        situacao: 'identidade-verificada',
        etapa: 'aguardando-conferencia',
        solicitante: 'titular',
        baixavel: false,
      }),
    ]);
    // O pedido de acesso aparece também nos pedidos do titular (o protocolado).
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === r.protocolo)?.tipo).toBe('acesso');

    const balcao = m.q('SINT.PRIVACIDADE');
    expect(await m.s.filaCopias(balcao, { pendentes: true })).toEqual([
      expect.objectContaining({
        protocolo: r.protocolo,
        canal: 'portal',
        paciente: 1001,
        etapa: 'aguardando-conferencia',
      }),
    ]);
    // Gerar ou entregar antes da legitimidade: recusado.
    await expect(m.s.gerarCopia(balcao, { protocolo: r.protocolo })).rejects.toMatchObject({ status: 409 });
    await expect(
      m.s.entregarCopia(balcao, { protocolo: r.protocolo, meio: 'portal', recebedor: null }),
    ).rejects.toMatchObject({ status: 409, detalhe: expect.stringMatching(/legitimidade/) });
    await m.s.conferirLegitimidadeCopia(balcao, {
      protocolo: r.protocolo,
      solicitante: 'titular',
      vinculo: null,
      prova: null,
    });
    await expect(
      m.s.conferirLegitimidadeCopia(balcao, {
        protocolo: r.protocolo,
        solicitante: 'titular',
        vinculo: null,
        prova: null,
      }),
    ).rejects.toMatchObject({ status: 409, detalhe: expect.stringMatching(/já foi conferida/) });
    await expect(
      m.s.entregarCopia(balcao, { protocolo: r.protocolo, meio: 'portal', recebedor: null }),
    ).rejects.toMatchObject({ detalhe: expect.stringMatching(/Gere o PDF/) });
    const g1 = await m.s.gerarCopia(balcao, { protocolo: r.protocolo });
    const texto = Buffer.from(g1.pdf).toString('latin1');
    expect(texto.startsWith('%PDF-1.4')).toBe(true);
    expect(texto).toContain(`CÓPIA ${r.protocolo}`.replace('Ó', '\xd3'));
    expect(texto).toContain(
      'Evolução: estável'.replace('ç', '\xe7').replace('ã', '\xe3').replace('á', '\xe1'),
    );
    expect(g1.hash).toMatch(/^[a-f0-9]{64}$/);
    m.avancar(1 / 24);
    const g2 = await m.s.gerarCopia(balcao, { protocolo: r.protocolo });
    expect(g2.hash).not.toBe(g1.hash);
    // Balcão sem quem recebeu: recusado; pelo portal, entregue e o pedido atendido.
    await expect(
      m.s.entregarCopia(balcao, { protocolo: r.protocolo, meio: 'balcao', recebedor: null }),
    ).rejects.toMatchObject({ detalhe: expect.stringMatching(/quem recebeu/) });
    await m.s.entregarCopia(balcao, { protocolo: r.protocolo, meio: 'portal', recebedor: null });
    expect((await m.s.atosDaCopia(balcao, r.protocolo)).map((a) => a.ato)).toEqual([
      'solicitacao',
      'legitimidade',
      'geracao',
      'geracao',
      'entrega',
    ]);
    expect(await m.s.filaCopias(balcao, { pendentes: true })).toEqual([]);
    const [c] = await m.s.copias(n);
    expect(c).toMatchObject({ situacao: 'atendido', etapa: 'entregue', meio: 'portal', baixavel: true });
    expect(Buffer.from(await m.s.pdfDaCopia(n, r.protocolo)).equals(Buffer.from(g2.pdf))).toBe(true);
    await expect(m.s.gerarCopia(balcao, { protocolo: r.protocolo })).rejects.toMatchObject({
      detalhe: expect.stringMatching(/já foi entregue/),
    });
    // Outra pessoa não vê nem baixa a cópia do José.
    const maria = await m.conta(1003, '1990-07-01', 'cinthya@portal.test');
    const nm = await m.s.sessao(maria.id);
    expect(await m.s.copias(nm)).toEqual([]);
    await expect(m.s.pdfDaCopia(nm, r.protocolo)).rejects.toMatchObject({ status: 404 });
  });

  it('no balcão: o familiar sem prova e o representante sem vínculo são recusados; o titular entra na fila', async () => {
    const m = montar();
    const balcao = m.q('SINT.PRIVACIDADE');
    await expect(
      m.s.pedirCopiaNoBalcao(balcao, {
        paciente: 1001,
        solicitante: 'herdeiro',
        vinculo: null,
        prova: null,
        observacao: null,
      }),
    ).rejects.toMatchObject({ status: 422, detalhe: expect.stringMatching(/certidão/) });
    await expect(
      m.s.pedirCopiaNoBalcao(balcao, {
        paciente: 1001,
        solicitante: 'representante',
        vinculo: null,
        prova: null,
        observacao: null,
      }),
    ).rejects.toMatchObject({ status: 422, detalhe: expect.stringMatching(/vínculo aprovado/) });
    const r = await m.s.pedirCopiaNoBalcao(balcao, {
      paciente: 1001,
      solicitante: 'herdeiro',
      vinculo: null,
      prova: 'certidão de óbito e de parentesco',
      observacao: null,
    });
    expect(await m.s.filaCopias(balcao, { pendentes: true, paciente: 1001 })).toEqual([
      expect.objectContaining({
        protocolo: r.protocolo,
        canal: 'balcao',
        solicitante: 'herdeiro',
        situacao: 'aberto',
      }),
    ]);
    // A legitimidade do familiar exige a prova também na conferência.
    await expect(
      m.s.conferirLegitimidadeCopia(balcao, {
        protocolo: r.protocolo,
        solicitante: 'herdeiro',
        vinculo: null,
        prova: '',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await m.s.conferirLegitimidadeCopia(balcao, {
      protocolo: r.protocolo,
      solicitante: 'herdeiro',
      vinculo: null,
      prova: 'certidão de óbito conferida',
    });
    expect((await m.s.filaCopias(balcao, { pendentes: true }))[0]).toMatchObject({
      situacao: 'identidade-verificada',
      etapa: 'legitimidade-conferida',
    });
    await expect(m.s.atosDaCopia(balcao, '2026-999999')).rejects.toMatchObject({ status: 404 });
  });
});

describe('W0-10 (M3): portabilidade em FHIR/IPS pelo portal', () => {
  it('só o pedido de portabilidade atendido baixa o pacote; o Bundle valida e o SHA-256 vai à trilha', async () => {
    const { validarPacoteIps } = await import('@sgh/dominio-integracao');
    const m = montar();
    const linhas: RegistroTrilhaPortal[] = [];
    const orig = m.porta.gravar.bind(m.porta);
    m.porta.gravar = async (c, fn, t) => {
      const r = await orig(c, fn, t);
      const l = typeof t === 'function' ? t(r) : t;
      if (l) linhas.push(l);
      return r;
    };
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const n = await m.s.sessao(jose.id);
    const port = await m.s.registrarPedido(n, { tipo: 'portabilidade', descricao: null });
    const acesso = await m.s.registrarPedido(n, { tipo: 'acesso', descricao: null });
    // Aberto: 409, e o item não oferece o download.
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === port.protocolo)?.pacoteIps).toBe(false);
    await expect(m.s.pacoteIps(n, port.protocolo)).rejects.toMatchObject({ status: 409 });
    const pedidos = await m.porta.pedidos({ rede: 'r', hospital: 'aa' }, Number(jose.conta), 1001);
    for (const p of pedidos) Object.assign(p, { situacao: 'atendido', decididoEm: m.agora().toISOString() });
    // Atendido, mas sem a fonte dos dados ligada: 503 e sem o botão.
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === port.protocolo)?.pacoteIps).toBe(false);
    await expect(m.s.pacoteIps(n, port.protocolo)).rejects.toMatchObject({ status: 503 });
    m.s.fonteIps = async (_c, paciente) => ({
      paciente: {
        id: paciente,
        cpf: null,
        cns: null,
        nome: 'Paciente Sintético',
        nascimento: null,
        sexo: 'M',
      },
      estabelecimento: {
        cnes: '1234567',
        cnpj: null,
        nome: 'Hospital Sintético',
        apelido: 'aa',
        cidade: '',
        uf: '',
      },
      problemas: [{ id: '1', descricao: 'Hipertensão', cid10: 'I10', desde: null, ativo: true }],
      alergias: [{ id: '2', descricao: 'Dipirona', reacao: null, critica: false }],
      medicamentos: [
        { id: '3', descricao: 'Losartana 50 mg', posologia: '1 cp · VO', desde: m.agora(), ativo: true },
      ],
    });
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === port.protocolo)?.pacoteIps).toBe(true);
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === acesso.protocolo)?.pacoteIps).toBe(false);
    const r = await m.s.pacoteIps(n, port.protocolo);
    const bundle = JSON.parse(r.json) as Record<string, unknown>;
    expect(bundle['resourceType']).toBe('Bundle');
    expect(validarPacoteIps(bundle)).toEqual([]);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    // Determinístico para os mesmos dados (o hash da trilha confere com o arquivo baixado).
    expect((await m.s.pacoteIps(n, port.protocolo)).hash).toBe(r.hash);
    const l = linhas.filter((x) => x.evento === 'portal.portabilidade.ips');
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({
      operacao: 'portal.portabilidadeIps',
      tabelaAlvo: 'pedido_titular',
      chaveNaturalAlvo: `${port.protocolo}:ips:${r.hash}`,
    });
    // O pedido de outro tipo e o protocolo inexistente: 404.
    await expect(m.s.pacoteIps(n, acesso.protocolo)).rejects.toMatchObject({ status: 404 });
    await expect(m.s.pacoteIps(n, '2026-999999')).rejects.toMatchObject({ status: 404 });
  });

  it('revisão: a área de privacidade em memória vê o pedido do portal (canal portal) e o atende; o portal passa a oferecer o pacote', async () => {
    const {
      estadoM10Sintetico,
      fonteAdministracaoMemoria,
      reiniciarEstadoM10Sintetico,
      BASE_ID_PEDIDO_PORTAL,
    } = await import('../../administracao/fonte-memoria.js');
    const { RegistradorTrilhaMemoria } = await import('../../../autorizacao/trilha.js');
    const { esquemaPedidoTitular } = await import('@sgh/contratos');
    reiniciarEstadoM10Sintetico();
    const m = montar();
    estadoM10Sintetico().pedidosDoPortal = m.porta.pedidosParaPrivacidade();
    const adm = fonteAdministracaoMemoria(new RegistradorTrilhaMemoria(), null as never, 'dev');
    const jose = await m.conta(1001, '1958-03-12', 'jose@portal.test');
    const n = await m.s.sessao(jose.id);
    const port = await m.s.registrarPedido(n, { tipo: 'portabilidade', descricao: null });
    const ca = { rede: 'r', hospital: 'aa' } as never;
    const lido = (await adm.pedidos(ca)).find((p) => p.protocolo === port.protocolo)!;
    expect(lido).toMatchObject({
      canal: 'portal',
      tipo: 'portabilidade',
      idPaciente: 1001,
      prontuario: 501001,
    });
    expect(Number(lido.id)).toBeGreaterThan(BASE_ID_PEDIDO_PORTAL);
    // A lista da tela aceita o canal portal (antes, o esquema recusava a resposta inteira).
    expect(
      esquemaPedidoTitular.safeParse({
        ...lido,
        abertoEm: lido.abertoEm.toISOString(),
        prazo: lido.prazo.toISOString(),
        decididoEm: null,
        atrasado: false,
      }).success,
    ).toBe(true);
    // Outro estabelecimento não vê o pedido do 'aa'.
    expect(
      (await adm.pedidos({ rede: 'r', hospital: 'bb' } as never)).some((p) => p.protocolo === port.protocolo),
    ).toBe(false);
    const vistos: string[] = [];
    const decidir = (acao: 'confirmar-identidade' | 'atender', recusa: string | null = null) =>
      adm.tratarPedido(
        ca,
        {
          id: lido.id,
          acao,
          fundamento: null,
          resposta: null,
          por: 'SINT.PRIVACIDADE',
          conferir: (p) => {
            vistos.push(p.situacao);
            return recusa;
          },
        },
        { registrar: async () => undefined } as never,
      );
    // A regra da transição recebe o pedido do portal e a recusa dela não grava nada.
    await expect(decidir('atender', 'Confirme a identidade antes.')).rejects.toBeTruthy();
    expect(vistos).toEqual([lido.situacao]);
    expect((await adm.pedidos(ca)).find((p) => p.id === lido.id)?.situacao).toBe(lido.situacao);
    if (lido.situacao === 'aberto') await decidir('confirmar-identidade');
    expect((await decidir('atender')).situacao).toBe('atendido');
    m.s.fonteIps = async () => {
      throw new Error('não chamado aqui');
    };
    expect((await m.s.pedidos(n)).find((p) => p.protocolo === port.protocolo)).toMatchObject({
      situacao: 'atendido',
      pacoteIps: true,
    });
    reiniciarEstadoM10Sintetico();
  });
});
