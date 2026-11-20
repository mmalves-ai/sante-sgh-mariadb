// Integração da assinatura ICP-Brasil, etapa 1, na cópia (ficha do M49, seção 10: "integração com simulador de PSC e
// de ACT: OAuth, falha, reprocessamento"), sempre em transação DESFEITA: o serviço sobre a porta do legado numa
// transação aberta (as tabelas SGH_ dos scripts 0490 a 0494) e o simulador do provedor, da ACT e da LCR:
//   - vincular em nuvem (OAuth 2.0 + PKCE, segredo do cofre) e a assinatura de conferência válida com o carimbo;
//   - a ACT fora do ar: a assinatura fica PENDENTE com a próxima tentativa marcada (regra 5), nunca "válida";
//   - o state reaproveitado é recusado; a política abaixo do piso legal é recusada sem gravar;
//   - só tabelas SGH_ escritas na transação (monitoramento): nenhuma do legado.
// A identidade (CPF) é SINTÉTICA (sobreposta à porta): nenhum CPF de pessoa da cópia é lido aqui.
import { CPF_SINTETICO_SESSAO } from '@sgh/dominio-documento';
import { contagensAssinaturaSgh, escritasDaTransacao } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { ServicoAssinaturaIcp } from './aplicacao/servico.js';
import { configAssinaturaDoAmbiente } from './infra/ambiente.js';
import { portaAssinaturaNaTransacao } from './porta-legado.js';
import type { PortaAssinaturaIcp } from './porta.js';

const LOGIN = 'SGH.TESTE.M49';

describe.skipIf(!PODE_ESCREVER)('assinatura ICP na cópia com o simulador (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('vincula, assina e valida; ACT fora deixa pendente; state de uso único; política sob o piso recusada; só SGH_', async () => {
    const s: SessaoCadastro = {
      req: { headers: {}, ip: '127.0.0.1' } as unknown as RequisicaoAutorizada,
      hospital: a.cod,
      rede: a.c.rede,
      login: LOGIN,
      porta: a.c,
      pode: () => true,
    };
    const cfg = await configAssinaturaDoAmbiente({}, true, null, process.cwd());
    const sim = cfg.simulador!;
    const volta = (endereco: string) => {
      const q = Object.fromEntries(new URL(endereco, 'http://x').searchParams);
      const v = new URL(sim.autorizar(q, CPF_SINTETICO_SESSAO), 'http://x').searchParams;
      return { state: v.get('state')!, code: v.get('code'), erro: v.get('error') };
    };
    const contar = () =>
      a.nucleo.lerSomente({ ...a.c, traceId: 'int-m49-conferencia' }, (l) =>
        contagensAssinaturaSgh(l, a.cod, LOGIN, 'simulador'),
      );
    const antes = await contar();
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m49' }, async (e) => {
      const base = portaAssinaturaNaTransacao(e);
      const porta: PortaAssinaturaIcp = {
        ...base,
        identidade: async () => ({ cpf: CPF_SINTETICO_SESSAO, cpfProfissional: null, registros: [] }),
      };
      const servico = new ServicoAssinaturaIcp(porta, new RegistradorTrilhaMemoria(), cfg);
      const vinculo = await servico.retornoPsc(
        s,
        volta((await servico.iniciarVinculoNuvem(s, 'simulador')).endereco),
      );
      const t1 = await servico.iniciarTeste(s, vinculo.certificado!);
      const v1 = volta(t1.tipo === 'nuvem' ? t1.endereco : '');
      const valida = await servico.retornoPsc(s, v1);
      const repetida = await servico.retornoPsc(s, v1);
      sim.foraDoAr.act = true;
      const t2 = await servico.iniciarTeste(s, vinculo.certificado!);
      const pendente = await servico.retornoPsc(s, volta(t2.tipo === 'nuvem' ? t2.endereco : ''));
      sim.foraDoAr.act = false;
      let sobPiso = '';
      try {
        await servico.definirPolitica(s, {
          tipoDocumento: 'receita-controlada',
          conselho: null,
          destino: 'externo',
          nivel: 'eletronica-avancada',
          politicaIcp: null,
          formato: 'pades',
          justificativa: 'Teste sintético abaixo do piso legal',
        });
      } catch (x) {
        sobPiso = (x as Error).message;
      }
      const tela = await servico.meuCertificado(s);
      return { vinculo, valida, repetida, pendente, sobPiso, tela, escritas: await escritasDaTransacao(e) };
    });
    expect(r.vinculo).toMatchObject({ ok: true, finalidade: 'vincular' });
    expect(r.valida).toMatchObject({ ok: true, finalidade: 'teste' });
    expect(r.repetida).toMatchObject({ ok: false, motivo: 'autorizacao-expirada' });
    expect(r.pendente).toMatchObject({ ok: false, motivo: 'carimbo-indisponivel' });
    expect(r.sobPiso).not.toBe('');
    expect(r.tela.certificados).toHaveLength(1);
    const [segunda, primeira] = r.tela.testes;
    expect(primeira).toMatchObject({ estado: 'assinada', validacao: { resultado: 'valida', carimbo: true } });
    expect(segunda).toMatchObject({ estado: 'pendente', falha: 'act-indisponivel' });
    expect(r.escritas.length).toBeGreaterThan(0);
    for (const w of r.escritas) expect(w.tabela).toMatch(/^SGH_/);
    // ROLLBACK: as seis tabelas e a SGH_TRILHA do login e do provedor simulado com as contagens de antes (relidas
    // pelo adaptador, sem SQL aqui): 0 linha deixada.
    expect(await contar()).toEqual(antes);
  }, 300_000);
});
