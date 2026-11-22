// O portal e a vigia sobre o contexto do núcleo (unidade, sem banco): o contexto da porta não tem usuário interno, a
// linha da trilha vai à tabela do modelo (acesso_resultado_portal; aviso_valor_critico) com o IP e sem nome, e a
// tentativa errada conta e bloqueia pelos parâmetros. Porta dublê; dados sintéticos.
import { describe, expect, it } from 'vitest';
import type { PortaSadt } from '../porta.js';
import { ServicoPortal } from './portal.js';
import { TABELA_PORTAL } from './servico.js';

function dubla() {
  const chamadas: { c: unknown; trilha: unknown; tentativa?: unknown }[] = [];
  const acesso = {
    id: 41,
    perfil: 'paciente',
    situacao: 'ativo',
    paciente: 9001,
    reg: 77,
    tentativas: 0,
    bloqueadoAte: null,
    senhaResumo: null,
    segundoFator: null,
    solicitante: null,
    nome: null,
  };
  const p = {
    destino: 'memoria',
    acessoPorProtocolo: async () => acesso,
    nascimentoDoPaciente: async () => ({ nome: 'Pessoa Sintetica', nascimento: '2000-01-01' }),
    gravarSgh: async (c: unknown, t: unknown, f: (g: unknown) => Promise<unknown>) => {
      const reg: { c: unknown; trilha: unknown; tentativa?: unknown } = { c, trilha: t };
      chamadas.push(reg);
      return f({
        registrarTentativaPortal: async (r: unknown) => {
          reg.tentativa = r;
        },
      });
    },
  };
  return { porta: p as unknown as PortaSadt, chamadas };
}

describe('ServicoPortal no contexto do núcleo', () => {
  it('a tentativa errada vai à trilha da tabela do acesso, sem usuário interno, e conta 1', async () => {
    const { porta, chamadas } = dubla();
    const portal = new ServicoPortal(porta, 'rede', null, null, 'Produto');
    await expect(
      portal.entrarPaciente('aa', { protocolo: 'ABCDE23456', nascimento: '1999-12-31' }, '10.0.0.9'),
    ).rejects.toMatchObject({ tipo: 'nao-autenticado' });
    expect(chamadas).toHaveLength(1);
    const [x] = chamadas;
    expect(x?.c).toMatchObject({ usuario: null, hospital: 'aa' });
    expect(x?.trilha).toMatchObject({
      usuario: null,
      acao: 'operacao',
      entidade: TABELA_PORTAL,
      entidadeId: 41,
      enderecoIp: '10.0.0.9',
      dadosDepois: { resultado: 'falha', paciente: 9001 },
    });
    expect(JSON.stringify(x?.trilha)).not.toMatch(/Pessoa|SGH_|SILANEXA/);
    expect(x?.tentativa).toMatchObject({ id: 41, tentativas: 1, acertou: false });
  });

  it('o acerto abre a sessão do portal com o primeiro nome e zera as tentativas', async () => {
    const { porta, chamadas } = dubla();
    const portal = new ServicoPortal(porta, 'rede', null, null, 'Produto');
    const r = await portal.entrarPaciente(
      'aa',
      { protocolo: 'ABCDE23456', nascimento: '2000-01-01' },
      '10.0.0.9',
    );
    expect(r.sessao).toMatchObject({ perfil: 'paciente', nome: 'Pessoa' });
    expect(chamadas[0]?.tentativa).toMatchObject({ tentativas: 0, acertou: true });
  });
});
