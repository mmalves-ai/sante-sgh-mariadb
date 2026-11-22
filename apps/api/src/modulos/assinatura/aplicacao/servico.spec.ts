// Serviço de assinatura ICP-Brasil, etapa 1 (regras 1, 2, 3, 5, 6 e 12) de ponta a ponta sobre a porta em memória e
// o SIMULADOR do provedor, da ACT e da LCR: vincular em nuvem (OAuth 2.0 + PKCE, o segredo saído do cofre), CPF
// divergente recusado, state de uso único, a assinatura de conferência validada no servidor (assinatura do hash,
// cadeia, LCR, CPF e carimbo do tempo), as fontes fora do ar deixando pendente (regra 5), o revogado inválido, o
// A1/A3 pelo agente local (desafio), a política nunca abaixo do piso legal e os provedores com o segredo só no cofre.
// Certificados e CPF SINTÉTICOS; nenhum dado de pessoa.
import { randomBytes } from 'node:crypto';
import { MOTIVOS_RECUSA_ASSINATURA } from '@sgh/contratos';
import {
  assinarHashRsa,
  CPF_SINTETICO_OUTRO,
  CPF_SINTETICO_SESSAO,
  criarRaizSintetica,
  emitirSintetico,
} from '@sgh/dominio-documento';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { configAssinaturaDoAmbiente } from '../infra/ambiente.js';
import { ROTA_NAVEGADOR_SIMULADOR, type SimuladorIcp } from '../infra/simulador.js';
import { PortaAssinaturaMemoria } from '../porta-memoria.js';
import {
  type ConfigServicoAssinatura,
  cpfCruzadoDiverge,
  ServicoAssinaturaIcp,
  tipoCertificadoDoProvedor,
} from './servico.js';

const LOGIN = 'MEDICO.SINTETICO';

function sessao(
  pode: (c: string) => boolean = () => true,
  o: { hospital?: string; login?: string; como?: boolean } = {},
): SessaoCadastro {
  const req = {
    headers: {},
    ip: '127.0.0.1',
    ...(o.como ? { sghComo: { alvoNome: 'Alvo sintético' } } : {}),
  } as unknown as RequisicaoAutorizada;
  const hospital = o.hospital ?? 'pc';
  return {
    req,
    hospital,
    rede: 'rede-sintetica',
    login: o.login ?? LOGIN,
    porta: {
      rede: 'rede-sintetica',
      hospital,
      cliente: 'teste',
      estabelecimento: 1,
      usuario: 1,
      correlacao: 'teste',
    },
    pode,
  };
}

/** A confirmação da senha que não deve ser pedida (falha o teste se for chamada). */
const semSenha = async () => {
  throw new Error('A senha não devia ser pedida.');
};

async function recusada(
  p: Promise<unknown>,
): Promise<{ status: number; detalhe: string; motivo: string | undefined }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema)
      return {
        status: e.getStatus(),
        detalhe: e.detalhe ?? '',
        motivo: (e.extras as { motivo?: string }).motivo,
      };
    throw e;
  }
  throw new Error('Era para ser recusada.');
}

let porta: PortaAssinaturaMemoria;
let trilha: RegistradorTrilhaMemoria;
let cfg: ConfigServicoAssinatura;
let sim: SimuladorIcp;
let servico: ServicoAssinaturaIcp;
const s = sessao();

beforeEach(async () => {
  porta = new PortaAssinaturaMemoria();
  trilha = new RegistradorTrilhaMemoria();
  cfg = await configAssinaturaDoAmbiente({}, true, null, process.cwd());
  sim = cfg.simulador!;
  servico = new ServicoAssinaturaIcp(porta, trilha, cfg);
});

/** O navegador abre a página do simulador, o titular digita o CPF e volta com o código. */
function autorizarNoSimulador(
  endereco: string,
  cpf: string,
): { state: string; code: string | null; erro: string | null } {
  expect(endereco.startsWith(`${ROTA_NAVEGADOR_SIMULADOR}/oauth/authorize?`)).toBe(true);
  const q = Object.fromEntries(new URL(endereco, 'http://x').searchParams);
  // Só o desafio do PKCE vai ao provedor; nunca o verificador, nem hash de documento.
  expect(q['code_challenge_method']).toBe('S256');
  expect(Object.keys(q)).not.toContain('code_verifier');
  const volta = new URL(sim.autorizar(q, cpf), 'http://x').searchParams;
  return { state: volta.get('state')!, code: volta.get('code'), erro: volta.get('error') };
}

async function vincularNuvem(cpf = CPF_SINTETICO_SESSAO) {
  const a = await servico.iniciarVinculoNuvem(s, 'simulador');
  return servico.retornoPsc(s, autorizarNoSimulador(a.endereco, cpf));
}

describe('certificado em nuvem (OAuth 2.0 + PKCE no simulador)', () => {
  it('vincula o certificado do titular autorizado; a tela vê só o CPF mascarado', async () => {
    const r = await vincularNuvem();
    expect(r).toMatchObject({ finalidade: 'vincular', ok: true, motivo: null });
    const m = await servico.meuCertificado(s);
    expect(m.modo).toBe('simulador');
    expect(m.provedores).toEqual([{ codigo: 'simulador', nome: 'Provedor simulado (somente teste)' }]);
    expect(m.certificados).toHaveLength(1);
    expect(m.certificados[0]).toMatchObject({
      midia: 'nuvem',
      provedor: 'simulador',
      tipo: 'A3',
      ativo: true,
    });
    expect(m.certificados[0]!.cpfMascarado).toMatch(/^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    expect(JSON.stringify(m)).not.toContain(CPF_SINTETICO_SESSAO);
    expect(porta.trilhas.map((t) => t.evento)).toContain('documento.certificado.vinculado');
    expect(JSON.stringify(porta.trilhas)).not.toContain(CPF_SINTETICO_SESSAO);
  });

  it('CPF do titular diferente do usuário: recusa (regra 2), nada vinculado, a recusa vai à trilha', async () => {
    const r = await vincularNuvem(CPF_SINTETICO_OUTRO);
    expect(r).toMatchObject({ ok: false, motivo: 'cpf-divergente' });
    expect((await servico.meuCertificado(s)).certificados).toHaveLength(0);
    expect(
      trilha.eventos.some((e) => e.evento === 'documento.certificado.vinculado' && e.resultado === 'falha'),
    ).toBe(true);
  });

  it('o state vale uma vez; o vencido e o negado no provedor não vinculam', async () => {
    const a = await servico.iniciarVinculoNuvem(s, 'simulador');
    const volta = autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO);
    expect((await servico.retornoPsc(s, volta)).ok).toBe(true);
    expect(await servico.retornoPsc(s, volta)).toMatchObject({ ok: false, motivo: 'autorizacao-expirada' });
    const b = await servico.iniciarVinculoNuvem(s, 'simulador');
    const negado = {
      ...autorizarNoSimulador(b.endereco, CPF_SINTETICO_SESSAO),
      code: null,
      erro: 'access_denied',
    };
    expect(await servico.retornoPsc(s, negado)).toMatchObject({ ok: false, motivo: 'autorizacao-negada' });
    expect(await servico.retornoPsc(s, { state: 'x'.repeat(43), code: 'c', erro: null })).toMatchObject({
      ok: false,
      motivo: 'autorizacao-expirada',
    });
  });

  it('o mesmo certificado duas vezes: 409; provedor fora do ar: psc-indisponivel', async () => {
    await vincularNuvem();
    expect(await vincularNuvem()).toMatchObject({ ok: false, motivo: 'ja-vinculado' });
    const a = await servico.iniciarVinculoNuvem(s, 'simulador');
    const volta = autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO);
    sim.foraDoAr.psc = true;
    expect(await servico.retornoPsc(s, volta)).toMatchObject({ ok: false, motivo: 'psc-indisponivel' });
  });

  it('desvincular só inativa; o certificado inativo não assina', async () => {
    const { certificado } = await vincularNuvem();
    const c = await servico.desvincular(s, certificado!);
    expect(c.ativo).toBe(false);
    expect((await recusada(servico.desvincular(s, certificado!))).status).toBe(409);
    expect((await recusada(servico.iniciarTeste(s, certificado!))).motivo).toBe('certificado-divergente');
  });
});

describe('assinatura de conferência validada no servidor (regra 3)', () => {
  async function testar() {
    const { certificado } = await vincularNuvem();
    const a = await servico.iniciarTeste(s, certificado!);
    if (a.tipo !== 'nuvem') throw new Error('nuvem');
    return servico.retornoPsc(s, autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO));
  }

  it('assina só o hash, confere a assinatura, a cadeia, a LCR, o CPF e o carimbo do tempo (AD-RT)', async () => {
    const r = await testar();
    expect(r).toMatchObject({ finalidade: 'teste', ok: true, motivo: null });
    const t = (await servico.meuCertificado(s)).testes[0]!;
    expect(t).toMatchObject({ estado: 'assinada', politicaIcp: 'AD-RT', falha: null });
    expect(t.carimboEm).not.toBeNull();
    expect(t.validacao).toMatchObject({
      resultado: 'valida',
      cadeia: true,
      vigencia: true,
      revogacao: true,
      cpf: true,
      assinaturaConfere: true,
      carimbo: true,
      motivos: [],
    });
    expect(
      porta.trilhas.some((x) => x.evento === 'documento.assinatura.assinado' && x.resultado === 'sucesso'),
    ).toBe(true);
  });

  it('ACT fora do ar: pendente para reprocessar (regra 5), nunca "válida"', async () => {
    sim.foraDoAr.act = true;
    const r = await testar();
    expect(r).toMatchObject({ ok: false, motivo: 'carimbo-indisponivel' });
    const t = (await servico.meuCertificado(s)).testes[0]!;
    expect(t).toMatchObject({ estado: 'pendente', falha: 'act-indisponivel' });
    expect(t.validacao?.resultado).toBe('indeterminada');
    expect(porta.trilhas.some((x) => x.evento === 'documento.assinatura.falhou')).toBe(true);
  });

  it('LCR fora do ar: indeterminada e pendente; revogado: inválida', async () => {
    sim.foraDoAr.lcr = true;
    await testar();
    expect((await servico.meuCertificado(s)).testes[0]).toMatchObject({
      estado: 'pendente',
      falha: 'lcr-indisponivel',
    });
    sim.foraDoAr.lcr = false;
    sim.revogar(CPF_SINTETICO_SESSAO);
    const { certificado } = (await servico.meuCertificado(s)).certificados[0]!
      ? { certificado: (await servico.meuCertificado(s)).certificados[0]!.id }
      : { certificado: 0 };
    const a = await servico.iniciarTeste(s, certificado);
    if (a.tipo !== 'nuvem') throw new Error('nuvem');
    const r = await servico.retornoPsc(s, autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO));
    expect(r).toMatchObject({ ok: false, motivo: 'revogado' });
    expect((await servico.meuCertificado(s)).testes[0]).toMatchObject({ estado: 'falha' });
  });

  it('validar: assinatura de outro hash ou de outra chave não confere', async () => {
    const t = sim.titular(CPF_SINTETICO_SESSAO);
    const hash = randomBytes(32).toString('hex');
    const outro = randomBytes(32);
    const v = await servico.validar({
      certificadoDer: t.certificado,
      hash,
      assinatura: assinarHashRsa(t.chave, outro),
      politica: 'AD-RT',
      cpfDoUsuario: CPF_SINTETICO_SESSAO,
    });
    expect(v).toMatchObject({ resultado: 'invalida', assinaturaConfere: false, carimbo: null });
    expect(v.motivos[0]).toBe('assinatura-nao-confere');
  });
});

describe('A1/A3 pelo agente local (desafio com os hashes)', () => {
  async function vincularA1() {
    const t = sim.titular(CPF_SINTETICO_SESSAO);
    const c = await servico.vincularArquivo(s, {
      midia: 'a1',
      provedor: null,
      certificado: Buffer.from(t.certificado).toString('base64'),
    });
    return { t, c };
  }

  it('vincula a parte pública, assina o desafio no agente e valida', async () => {
    const { t, c } = await vincularA1();
    expect(c).toMatchObject({ midia: 'a1', provedor: null });
    const d = await servico.iniciarTeste(s, c.id);
    if (d.tipo !== 'agente-local') throw new Error('agente');
    expect(d.hashes).toHaveLength(1);
    const r = await servico.respostaAgente(s, {
      desafio: d.desafio,
      assinaturas: d.hashes.map((h) => ({
        hash: h,
        assinatura: Buffer.from(assinarHashRsa(t.chave, Buffer.from(h, 'hex'))).toString('base64'),
      })),
      certificado: Buffer.from(t.certificado).toString('base64'),
    });
    expect(r).toMatchObject({ ok: true });
    expect((await servico.meuCertificado(s)).testes[0]?.validacao?.resultado).toBe('valida');
  });

  it('recusa hash a mais, certificado de outro titular e desafio reaproveitado', async () => {
    const { t, c } = await vincularA1();
    const d = await servico.iniciarTeste(s, c.id);
    if (d.tipo !== 'agente-local') throw new Error('agente');
    const extra = randomBytes(32).toString('hex');
    const sig = (h: string) => Buffer.from(assinarHashRsa(t.chave, Buffer.from(h, 'hex'))).toString('base64');
    const certB64 = Buffer.from(t.certificado).toString('base64');
    expect(
      await servico.respostaAgente(s, {
        desafio: d.desafio,
        assinaturas: [...d.hashes, extra].map((h) => ({ hash: h, assinatura: sig(h) })),
        certificado: certB64,
      }),
    ).toMatchObject({ ok: false, motivo: 'resposta-invalida' });
    // O desafio foi consumido na primeira resposta.
    expect(
      await servico.respostaAgente(s, {
        desafio: d.desafio,
        assinaturas: d.hashes.map((h) => ({ hash: h, assinatura: sig(h) })),
        certificado: certB64,
      }),
    ).toMatchObject({ ok: false, motivo: 'autorizacao-expirada' });
    const d2 = await servico.iniciarTeste(s, c.id);
    if (d2.tipo !== 'agente-local') throw new Error('agente');
    const outro = sim.titular(CPF_SINTETICO_OUTRO);
    expect(
      await servico.respostaAgente(s, {
        desafio: d2.desafio,
        assinaturas: d2.hashes.map((h) => ({ hash: h, assinatura: sig(h) })),
        certificado: Buffer.from(outro.certificado).toString('base64'),
      }),
    ).toMatchObject({ ok: false, motivo: 'certificado-divergente' });
  });

  it('recusa certificado de raiz não confiável, de outro CPF, sem não repúdio e arquivo que não é certificado', async () => {
    const agora = new Date();
    const estranha = criarRaizSintetica(agora, 'RAIZ NAO CONFIAVEL');
    const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
    const vincular = (der: Uint8Array) =>
      servico.vincularArquivo(s, { midia: 'a3', provedor: null, certificado: b64(der) });
    expect(
      (await recusada(vincular(emitirSintetico(estranha, { cpf: CPF_SINTETICO_SESSAO }, agora).certificado)))
        .motivo,
    ).toBe('cadeia-invalida');
    expect((await recusada(vincular(sim.titular(CPF_SINTETICO_OUTRO).certificado))).motivo).toBe(
      'cpf-divergente',
    );
    expect(
      (
        await recusada(
          vincular(
            emitirSintetico(sim.raiz, { cpf: CPF_SINTETICO_SESSAO, usoDaChave: 0x80 }, agora).certificado,
          ),
        )
      ).motivo,
    ).toBe('uso-da-chave');
    expect(
      (
        await recusada(
          vincular(
            emitirSintetico(sim.raiz, { cpf: CPF_SINTETICO_SESSAO, politicas: ['1.2.3.4'] }, agora)
              .certificado,
          ),
        )
      ).motivo,
    ).toBe('certificado-fora-da-icp');
    expect((await recusada(vincular(Uint8Array.of(1, 2, 3)))).motivo).toBe('certificado-invalido');
    expect(
      (
        await recusada(
          servico.vincularArquivo(s, { midia: 'nuvem', provedor: 'simulador', certificado: 'AAAA' }),
        )
      ).status,
    ).toBe(422);
    // Todo motivo de recusa tem texto para a tela.
    for (const m of ['cadeia-invalida', 'cpf-divergente', 'uso-da-chave', 'certificado-invalido'] as const)
      expect(MOTIVOS_RECUSA_ASSINATURA[m]).toBeTruthy();
  });
});

describe('política por tipo de documento (regra 6)', () => {
  it('recusa abaixo do piso legal e ICP sem carimbo em prescrição e atestado; dizendo o mínimo', async () => {
    const j = 'Decisão da diretoria clínica sintética.';
    const r1 = await recusada(
      servico.definirPolitica(s, {
        tipoDocumento: 'atestado',
        conselho: null,
        destino: 'externo',
        nivel: 'eletronica-avancada',
        politicaIcp: null,
        formato: 'pades',
        justificativa: j,
      }),
    );
    expect(r1.status).toBe(422);
    expect(r1.detalhe).toContain('Qualificada (ICP-Brasil)');
    const r2 = await recusada(
      servico.definirPolitica(s, {
        tipoDocumento: 'prescricao',
        conselho: 'CRM',
        destino: 'interno',
        nivel: 'icp-brasil',
        politicaIcp: 'AD-RB',
        formato: 'pades',
        justificativa: j,
      }),
    );
    expect(r2.detalhe).toContain('AD-RT');
    expect(porta.trilhas).toHaveLength(0);
  });

  it('grava a regra, a vigente muda e, removida, volta o piso legal', async () => {
    const j = 'Meta de NGS2 para a evolução (sintético).';
    const antes = await servico.politicas(s);
    const vig = (r: typeof antes) =>
      r.vigente.find((v) => v.tipoDocumento === 'registro-clinico' && v.destino === 'interno')!.exigencia;
    expect(vig(antes)).toMatchObject({ nivel: 'eletronica-avancada', origem: 'piso-legal' });
    const depois = await servico.definirPolitica(s, {
      tipoDocumento: 'registro-clinico',
      conselho: null,
      destino: 'interno',
      nivel: 'icp-brasil',
      politicaIcp: 'AD-RB',
      formato: 'pades',
      justificativa: j,
    });
    expect(depois.regras).toHaveLength(1);
    expect(vig(depois)).toMatchObject({ nivel: 'icp-brasil', politicaIcp: 'AD-RB', carimboDoTempo: false });
    expect(porta.trilhas.at(-1)?.evento).toBe('documento.politica.alterada');
    const fim = await servico.removerPolitica(s, {
      tipoDocumento: 'registro-clinico',
      conselho: null,
      destino: 'interno',
      justificativa: j,
    });
    expect(fim.regras).toHaveLength(0);
    expect(vig(fim)).toMatchObject({ origem: 'piso-legal' });
    expect(
      (
        await recusada(
          servico.removerPolitica(s, {
            tipoDocumento: 'laudo',
            conselho: null,
            destino: 'interno',
            justificativa: j,
          }),
        )
      ).status,
    ).toBe(404);
    // A receita de controle especial é sempre ICP AD-RT pelo piso legal.
    expect(
      fim.vigente.find((v) => v.tipoDocumento === 'receita-controlada' && v.destino === 'interno')!.exigencia,
    ).toMatchObject({ nivel: 'icp-brasil', politicaIcp: 'AD-RT', carimboDoTempo: true });
  });
});

describe('provedores em nuvem e o segredo no cofre (ICP-06; regra 1)', () => {
  const j = 'Contrato do provedor sintético.';
  const provedor = (ativo: boolean) => ({
    codigo: 'psc-sintetico',
    nome: 'PSC sintético',
    uriBase: 'https://psc.sintetico.invalid/v0',
    clientId: 'cliente-sintetico',
    autoridades: ['AC UM'],
    ativo,
  });

  it('o simulador aparece com o segredo definido; o segredo nunca volta na resposta', async () => {
    const r = await servico.provedores(s);
    expect(r).toMatchObject({
      modo: 'simulador',
      cofre: 'disponivel',
      minimoAutoridades: 2,
      alertaAutoridades: [],
    });
    expect(r.provedores[0]).toMatchObject({ codigo: 'simulador', segredo: 'definido', simulado: true });
    expect((await servico.testarConexao(s, 'simulador')).ok).toBe(true);
  });

  it('não liga sem o segredo; com o segredo no cofre, liga; versão desatualizada é recusada', async () => {
    expect(
      (
        await recusada(
          servico.salvarProvedor(s, { provedor: provedor(true), versao: null, justificativa: j }, semSenha),
        )
      ).status,
    ).toBe(409);
    await servico.salvarProvedor(s, { provedor: provedor(false), versao: null, justificativa: j }, semSenha);
    const segredo = `segredo-${randomBytes(8).toString('hex')}`;
    const r = await servico.definirSegredo(s, 'psc-sintetico', { segredo, justificativa: j });
    expect(JSON.stringify(r)).not.toContain(segredo);
    expect(JSON.stringify(trilha.eventos)).not.toContain(segredo);
    expect(r.provedores.find((p) => p.codigo === 'psc-sintetico')).toMatchObject({
      segredo: 'definido',
      versao: 1,
    });
    const ligado = await servico.salvarProvedor(
      s,
      { provedor: provedor(true), versao: 1, justificativa: j },
      semSenha,
    );
    expect(ligado.provedores.find((p) => p.codigo === 'psc-sintetico')).toMatchObject({
      ativo: true,
      versao: 2,
    });
    expect(
      (
        await recusada(
          servico.salvarProvedor(s, { provedor: provedor(true), versao: 1, justificativa: j }, semSenha),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await recusada(
          servico.salvarProvedor(
            s,
            {
              provedor: { ...provedor(true), codigo: 'simulador' },
              versao: null,
              justificativa: j,
            },
            semSenha,
          ),
        )
      ).status,
    ).toBe(409);
    expect(
      (await recusada(servico.definirSegredo(s, 'nao-existe', { segredo, justificativa: j }))).status,
    ).toBe(404);
  });
});

describe('revisão do M49.1: trilha do pedido, dono do pedido e CPF cruzado a cada uso', () => {
  it('pedido gravado, consumido e assinatura: cada transação com a sua linha de trilha (sem state nem PKCE)', async () => {
    const { certificado } = await vincularNuvem();
    const a = await servico.iniciarTeste(s, certificado!);
    if (a.tipo !== 'nuvem') throw new Error('nuvem');
    const volta = autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO);
    await servico.retornoPsc(s, volta);
    // (o provedor simulado criado no primeiro uso tem a própria linha, fora desta conta)
    const eventos = porta.trilhas
      .filter((t) => t.evento !== 'documento.provedor.alterado')
      .map((t) => `${t.evento}|${t.operacao}|${t.entidade}`);
    expect(eventos).toEqual([
      'documento.assinatura.pedida|documento.vincularCertificado|pedido_assinatura',
      'documento.assinatura.autorizacao-consumida|documento.vincularCertificado|pedido_assinatura',
      'documento.certificado.vinculado|documento.vincularCertificado|certificado_usuario',
      'documento.assinatura.pedida|documento.assinar|pedido_assinatura',
      'documento.assinatura.autorizacao-consumida|documento.assinar|pedido_assinatura',
      'documento.assinatura.assinado|documento.assinar|assinatura_documento',
    ]);
    expect(JSON.stringify(porta.trilhas)).not.toContain(volta.state);
    // A volta repetida não acha pedido: nada consumido, nenhuma linha a mais na trilha da transação.
    const n = porta.trilhas.length;
    await servico.retornoPsc(s, volta);
    expect(porta.trilhas).toHaveLength(n);
  });

  it('a volta na sessão de outro usuário ou estabelecimento não gasta o pedido do dono', async () => {
    const a = await servico.iniciarVinculoNuvem(s, 'simulador');
    const volta = autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO);
    const outro = sessao(() => true, { login: 'OUTRO.SINTETICO' });
    expect(await servico.retornoPsc(outro, volta)).toMatchObject({
      ok: false,
      motivo: 'autorizacao-expirada',
    });
    const outroHospital = sessao(() => true, { hospital: 'hs' });
    expect(await servico.retornoPsc(outroHospital, volta)).toMatchObject({
      ok: false,
      motivo: 'autorizacao-expirada',
    });
    // O dono ainda usa o pedido.
    expect(await servico.retornoPsc(s, volta)).toMatchObject({ ok: true, finalidade: 'vincular' });
  });

  it('cadastro que ficou inconsistente depois do vínculo (CPF da conta ≠ CPF do profissional): nada assina', async () => {
    const { certificado } = await vincularNuvem();
    const a = await servico.iniciarTeste(s, certificado!);
    if (a.tipo !== 'nuvem') throw new Error('nuvem');
    porta.identidade = async () => ({
      cpf: CPF_SINTETICO_SESSAO,
      cpfProfissional: CPF_SINTETICO_OUTRO,
      registros: [],
    });
    expect(await servico.retornoPsc(s, autorizarNoSimulador(a.endereco, CPF_SINTETICO_SESSAO))).toMatchObject(
      { ok: false, motivo: 'cpf-divergente' },
    );
    // O agente local passa por concluirAssinatura: a mesma recusa, sem gravar a assinatura.
    const c = (await porta.certificado({ hospital: 'pc' }, certificado!))!;
    const r = await servico.concluirAssinatura(s, {
      certificado: c,
      hash: 'a'.repeat(64),
      assinatura: Uint8Array.of(1),
      provedor: null,
    });
    expect(r).toMatchObject({ ok: false, motivo: 'cpf-divergente', assinatura: null });
    expect((await servico.meuCertificado(s)).testes).toHaveLength(0);
    expect(trilha.eventos.filter((e) => e.chaveNaturalAlvo === 'cpf-divergente')).toHaveLength(2);
    expect(cpfCruzadoDiverge({ cpf: '1', cpfProfissional: null, registros: [] })).toBe(false);
  });

  it('tipo de certificado do cadastro (tipo_certificado): pelo provedor; A1/A3 e sem correspondência, null', async () => {
    const tipos = await porta.tiposCertificado();
    expect(tipoCertificadoDoProvedor(tipos, { codigo: 'safeweb', nome: 'Safeweb RFB' })).toBe(2);
    expect(tipoCertificadoDoProvedor(tipos, { codigo: 'psc-vidaas', nome: 'VIDaaS' })).toBe(3);
    expect(tipoCertificadoDoProvedor(tipos, { codigo: 'simulador', nome: 'Provedor simulado' })).toBeNull();
    expect(tipoCertificadoDoProvedor(tipos, null)).toBeNull();
    expect(
      tipoCertificadoDoProvedor(
        tipos.map((t) => ({ ...t, ativo: false })),
        { codigo: 'safeweb', nome: 'SafeWeb' },
      ),
    ).toBeNull();
    const { certificado } = await vincularNuvem();
    expect((await porta.certificado({ hospital: 'pc' }, certificado!))?.idTipoCertificado).toBeNull();
  });
});

describe('revisão do M49.1: política por conselho do cadastro', () => {
  it('as opções vêm do cadastro de conselhos; sigla fora dele é recusada sem gravar', async () => {
    expect((await servico.politicas(s)).conselhos).toContain('CRM');
    const r = await recusada(
      servico.definirPolitica(s, {
        tipoDocumento: 'registro-clinico',
        conselho: 'XYZ',
        destino: 'interno',
        nivel: 'icp-brasil',
        politicaIcp: 'AD-RB',
        formato: 'pades',
        justificativa: 'Regra sintética com conselho fora do cadastro.',
      }),
    );
    expect(r.status).toBe(422);
    expect(porta.trilhas).toHaveLength(0);
  });
});

describe('revisão do M49.1: o segredo do provedor é do estabelecimento', () => {
  const j = 'Contrato do provedor sintético.';
  const prov = (uriBase = 'https://psc.sintetico.invalid/v0', clientId = 'cliente-a') => ({
    codigo: 'psc-comum',
    nome: 'PSC comum',
    uriBase,
    clientId,
    autoridades: ['AC UM', 'AC DOIS'],
    ativo: false,
  });
  const hs = sessao(() => true, { hospital: 'hs' });

  it('o mesmo código em outro estabelecimento não vê, não usa e não sobrescreve o segredo', async () => {
    await servico.salvarProvedor(s, { provedor: prov(), versao: null, justificativa: j }, semSenha);
    await servico.definirSegredo(s, 'psc-comum', { segredo: 'segredo-do-pc-123', justificativa: j });
    await servico.salvarProvedor(
      hs,
      { provedor: prov('https://atacante.invalid/v0'), versao: null, justificativa: j },
      semSenha,
    );
    const noHs = (await servico.provedores(hs)).provedores.find((p) => p.codigo === 'psc-comum');
    expect(noHs).toMatchObject({ segredo: 'nao-definido' });
    // Ligar no hs exige o segredo do hs.
    expect(
      (
        await recusada(
          servico.salvarProvedor(
            hs,
            {
              provedor: { ...prov('https://atacante.invalid/v0'), ativo: true },
              versao: 1,
              justificativa: j,
            },
            semSenha,
          ),
        )
      ).status,
    ).toBe(409);
    await servico.definirSegredo(hs, 'psc-comum', { segredo: 'segredo-do-hs-456', justificativa: j });
    expect(await cfg.cofre.ler('cofre:psc/pc/psc-comum/client-secret')).toBe('segredo-do-pc-123');
    expect(await cfg.cofre.ler('cofre:psc/hs/psc-comum/client-secret')).toBe('segredo-do-hs-456');
  });

  it('trocar endereço ou client_id com o segredo definido pede a senha; sem a senha, nada muda', async () => {
    await servico.salvarProvedor(s, { provedor: prov(), versao: null, justificativa: j }, semSenha);
    // Sem segredo ainda: muda à vontade.
    await servico.salvarProvedor(
      s,
      { provedor: prov('https://psc2.sintetico.invalid/v0'), versao: 1, justificativa: j },
      semSenha,
    );
    await servico.definirSegredo(s, 'psc-comum', { segredo: 'segredo-do-pc-123', justificativa: j });
    // Só o nome: sem senha.
    await servico.salvarProvedor(
      s,
      {
        provedor: { ...prov('https://psc2.sintetico.invalid/v0'), nome: 'PSC comum renomeado' },
        versao: 2,
        justificativa: j,
      },
      semSenha,
    );
    let pedida = 0;
    const senhaErrada = async () => {
      pedida++;
      throw new ErroProblema('nao-autenticado', 401, 'Senha', 'Senha não confere.');
    };
    expect(
      (
        await recusada(
          servico.salvarProvedor(
            s,
            { provedor: prov('https://outro.invalid/v0'), versao: 3, justificativa: j },
            senhaErrada,
          ),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await recusada(
          servico.salvarProvedor(
            s,
            {
              provedor: prov('https://psc2.sintetico.invalid/v0', 'outro-cliente'),
              versao: 3,
              justificativa: j,
            },
            senhaErrada,
          ),
        )
      ).status,
    ).toBe(401);
    expect(pedida).toBe(2);
    expect((await porta.provedor({ hospital: 'pc' }, 'psc-comum'))?.uriBase).toBe(
      'https://psc2.sintetico.invalid/v0',
    );
    let ok = 0;
    await servico.salvarProvedor(
      s,
      { provedor: prov('https://outro.invalid/v0'), versao: 3, justificativa: j },
      async () => {
        ok++;
      },
    );
    expect(ok).toBe(1);
  });

  it('troca do segredo: a trilha antes do cofre; a falha do cofre vai à trilha; na sessão "como", recusada', async () => {
    await servico.salvarProvedor(s, { provedor: prov(), versao: null, justificativa: j }, semSenha);
    const ordem: string[] = [];
    const gravar = cfg.cofre.gravar.bind(cfg.cofre);
    cfg.cofre.gravar = async (r, v) => {
      ordem.push(`cofre:${porta.trilhas.length}`);
      return gravar(r, v);
    };
    await servico.definirSegredo(s, 'psc-comum', { segredo: 'segredo-do-pc-123', justificativa: j });
    expect(ordem).toEqual([`cofre:${porta.trilhas.length}`]);
    expect(porta.trilhas.at(-1)).toMatchObject({
      evento: 'documento.provedor.alterado',
      entidade: 'provedor_assinatura_nuvem',
      chave: 'psc-comum:troca-do-segredo',
    });
    cfg.cofre.gravar = async () => {
      throw new Error('disco cheio');
    };
    await expect(
      servico.definirSegredo(s, 'psc-comum', { segredo: 'segredo-novo-789', justificativa: j }),
    ).rejects.toThrow('disco cheio');
    expect(trilha.eventos.at(-1)).toMatchObject({ resultado: 'falha', chaveNaturalAlvo: 'cofre-falhou' });
    expect(await cfg.cofre.ler('cofre:psc/pc/psc-comum/client-secret')).toBe('segredo-do-pc-123');
    const como = sessao(() => true, { como: true });
    expect(
      (
        await recusada(
          servico.definirSegredo(como, 'psc-comum', { segredo: 'segredo-x-000', justificativa: j }),
        )
      ).status,
    ).toBe(409);
  });
});

describe('modo desligado', () => {
  it('fora de dev/ci sem a configuração: desligado, nada vincula nem assina', async () => {
    const off = await configAssinaturaDoAmbiente(
      { ASSINATURA_ICP_MODO: 'producao' },
      false,
      null,
      process.cwd(),
    );
    expect(off).toMatchObject({ modo: 'desligado', simulador: null });
    expect(off.cofre.disponivel).toBe(false);
    const sv = new ServicoAssinaturaIcp(porta, trilha, off);
    expect(
      (await recusada(sv.vincularArquivo(s, { midia: 'a1', provedor: null, certificado: 'AAAA' }))).motivo,
    ).toBe('servico-desligado');
    expect((await sv.meuCertificado(s)).provedores).toEqual([]);
    // Em dev/ci, "produção" é recusado: continua o simulador.
    expect(
      (await configAssinaturaDoAmbiente({ ASSINATURA_ICP_MODO: 'producao' }, true, null, process.cwd())).modo,
    ).toBe('simulador');
  });
});
