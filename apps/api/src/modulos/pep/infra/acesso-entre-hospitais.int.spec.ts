// Integração do acesso cruzado ao prontuário entre os estabelecimentos da rede (M57, etapa 2; ficha, seção 4 e regras
// 6 e 7) sobre o banco PRÓPRIO do cliente (um banco por cliente: os estabelecimentos da rede moram no mesmo banco).
// Cliente de teste f22_o4; massa SINTÉTICA do lote (estabelecimentos l0402r e l0402s, pessoas fictícias), montada no
// beforeAll e apagada no afterAll. O MPI é a porta própria da rede (o vínculo é a unificação efetivada dos cadastros) e
// a trilha é a própria (trilha_auditoria); o prontuário do outro estabelecimento (linha do tempo do M23) ainda não tem
// adaptador próprio e entra como dublê que registra a ordem das chamadas:
//   - regra 6: com o acesso cruzado desligado no outro estabelecimento, a recusa vem ANTES de qualquer leitura do
//     prontuário e de qualquer trilha (nada gravado); sem vínculo ativo (ou com a unificação revertida), 404;
//   - regra 7: com a regra ligada, a leitura vai à trilha NO ESTABELECIMENTO DO REGISTRO, antes da linha do tempo; sem
//     trilha, sem dado (503).
// Nenhum dado de pessoa: só contagens e ids sintéticos. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { PedidoProntuarioRede } from '@sgh/contratos';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { RegistradorTrilhaPropria } from '../../../autorizacao/trilha-propria.js';
import { PortaRedePropria } from '../../rede/porta-propria.js';
import { AcessoProntuarioRede, type SessaoAcessoRede } from '../acesso-rede.js';
import type { ServicoDocumentos } from '../documentos-servico.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = 'f22_o4';
const REDE = 'rede-l0402';
const P = 'l0402';
const AQUI = `${P}r`;
const LA = `${P}s`;
const PRONT = 904_022_000;
const PEDIDO: PedidoProntuarioRede = { motivo: 'assistencia', justificativa: 'Integração sintética do M57.2', pagina: 1 };

interface Massa {
  estAqui: number;
  estLa: number;
  usuario: number;
  pa: number;
  pb: number;
  pc: number;
  pd: number;
  pe: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const cods = [AQUI, LA];
  await e.executar(
    `DELETE FROM unificacao_cadastro WHERE mantido_paciente_id IN (SELECT id FROM paciente WHERE cadastro_estabelecimento_id IN ${est})
        OR absorvido_paciente_id IN (SELECT id FROM paciente WHERE cadastro_estabelecimento_id IN ${est})`,
    [...cods, ...cods],
  );
  await e.executar(`DELETE FROM paciente WHERE cadastro_estabelecimento_id IN ${est}`, cods);
  await e.executar('DELETE FROM pessoa_fisica WHERE nome LIKE ?', [`Pessoa sintética ${P}%`]);
  await e.executar(`DELETE FROM trilha_auditoria WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar('DELETE FROM usuario WHERE login LIKE ?', [`${P}.%`]);
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', cods);
}

describe.skipIf(SEM_BANCO)('acesso cruzado entre os estabelecimentos da rede (banco próprio, f22_o4)', () => {
  let nucleo: NucleoProprio;
  let m: Massa;
  let rede: PortaRedePropria;
  let ordem: string[];
  let ligadas: Set<string>;
  let trilhaFalha: boolean;
  let acesso: AcessoProntuarioRede;

  const sessao = (): SessaoAcessoRede => ({
    rede: REDE,
    hospital: AQUI,
    porta: { cliente: CLIENTE, estabelecimento: m.estAqui, usuario: null, correlacao: `c-${P}`, rede: REDE, hospital: AQUI },
    login: `${P}.medico`,
    estacao: 'estacao-sintetica',
    correlacao: `c-${P}`,
  });
  const trilhasLa = async (): Promise<number> =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `conta-${P}` }, async (l) =>
      Number((await l.uma('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [m.estLa]))?.['n']),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_f22_o4');
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const est = (codigo: string) =>
        e.inserir('INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)', [
          codigo,
          `Hospital sintético ${codigo}`,
          `Hospital sintético ${codigo} (fictício)`,
          agora,
        ]);
      const estAqui = await est(AQUI);
      const estLa = await est(LA);
      const usuario = await e.inserir('INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, ?, ?)', [
        `${P}.unificador`,
        'Conta de serviço sintética',
        'servico',
        agora,
      ]);
      let n = 0;
      const paciente = async (estab: number) => {
        const pf = await e.inserir('INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)', [
          `Pessoa sintética ${P} ${++n}`,
          agora,
        ]);
        return e.inserir(
          `INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, cadastro_estabelecimento_id, situacao, criado_em)
           VALUES (?, ?, ?, 'ativo', ?)`,
          [pf, PRONT + n, estab, agora],
        );
      };
      const [pa, pb, pc, pd, pe] = [
        await paciente(estAqui),
        await paciente(estLa),
        await paciente(estAqui),
        await paciente(estAqui),
        await paciente(estLa),
      ];
      await e.inserir(
        `INSERT INTO unificacao_cadastro (mantido_paciente_id, absorvido_paciente_id, unificado_em, unificado_por_usuario_id,
           justificativa, situacao, criado_em) VALUES (?, ?, ?, ?, ?, 'efetivada', ?)`,
        [pa, pb, agora, usuario, 'Mesma pessoa sintética', agora],
      );
      await e.inserir(
        `INSERT INTO unificacao_cadastro (mantido_paciente_id, absorvido_paciente_id, unificado_em, unificado_por_usuario_id,
           justificativa, situacao, revertido_em, revertido_por_usuario_id, motivo_reversao, criado_em)
         VALUES (?, ?, ?, ?, ?, 'revertida', ?, ?, ?, ?)`,
        [pd, pe, agora, usuario, 'Mesma pessoa sintética', agora, usuario, 'Pessoas diferentes (sintético)', agora],
      );
      return { estAqui, estLa, usuario, pa, pb, pc, pd, pe };
    });
    rede = new PortaRedePropria(nucleo, CLIENTE, REDE, undefined, () => undefined);
    await rede.carregar();
    const trilhaPropria = new RegistradorTrilhaPropria(nucleo, CLIENTE);
    const trilha: RegistradorTrilha = {
      registrar: async (e) => {
        ordem.push(`trilha:${e.hospital}`);
        if (trilhaFalha) throw new Error('trilha fora do ar (simulada)');
        return trilhaPropria.registrar(e);
      },
    };
    const documentos = {
      exigirPaciente: async (c: { hospital: string }, id: number) => {
        ordem.push(`exigir:${c.hospital}:${id}`);
      },
      linhaTempo: async (c: { hospital: string }, id: number) => {
        ordem.push(`linha:${c.hospital}:${id}`);
        return {
          eventos: [
            {
              chave: 'evento-sintetico',
              tipo: 'registro',
              quando: '2026-11-20T10:00:00',
              titulo: 'Evolução sintética',
              detalhe: null,
              profissional: null,
              situacao: null,
              suspenso: false,
              sigilo: false,
            },
          ],
          pagina: 1,
          temMais: false,
        };
      },
    } as unknown as Pick<ServicoDocumentos, 'linhaTempo' | 'exigirPaciente'>;
    acesso = new AcessoProntuarioRede({
      rede,
      documentos,
      trilha,
      ligadaNoEstabelecimento: async (_rede, hospital) => ligadas.has(hospital),
    });
  }, 120_000);
  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar();
    }
  });

  const recusa = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { getStatus(): number; extras?: { codigo?: string } }) => ({ status: e.getStatus(), codigo: e.extras?.codigo }),
    );

  it('regra 6: desligado no outro estabelecimento, recusa antes de ler e de gravar a trilha', async () => {
    ordem = [];
    ligadas = new Set([AQUI]);
    trilhaFalha = false;
    const antes = await trilhasLa();
    expect(await recusa(acesso.abrir(sessao(), m.pa, LA, PEDIDO, null))).toEqual({
      status: 403,
      codigo: 'recurso-desligado',
    });
    expect(ordem).toEqual([]);
    expect(await trilhasLa()).toBe(antes);
  });

  it('fora da rede (o próprio estabelecimento ou código inexistente): 403 antes de qualquer leitura', async () => {
    ordem = [];
    ligadas = new Set([AQUI, LA]);
    expect(await recusa(acesso.abrir(sessao(), m.pa, AQUI, PEDIDO, null))).toEqual({ status: 403, codigo: 'fora-da-rede' });
    expect(await recusa(acesso.abrir(sessao(), m.pa, `${P}zz`, PEDIDO, null))).toEqual({
      status: 403,
      codigo: 'fora-da-rede',
    });
    expect(ordem).toEqual([]);
  });

  it('sem vínculo ativo (nenhuma unificação, ou a revertida): 404 e nada gravado', async () => {
    ordem = [];
    ligadas = new Set([AQUI, LA]);
    const antes = await trilhasLa();
    expect(await recusa(acesso.abrir(sessao(), m.pc, LA, PEDIDO, null))).toEqual({
      status: 404,
      codigo: 'sem-vinculo-rede',
    });
    expect(await recusa(acesso.abrir(sessao(), m.pd, LA, PEDIDO, null))).toEqual({
      status: 404,
      codigo: 'sem-vinculo-rede',
    });
    expect(ordem).toEqual([]);
    expect(await trilhasLa()).toBe(antes);
  });

  it('regra 7: a leitura vai à trilha no estabelecimento do registro, antes da linha do tempo', async () => {
    ordem = [];
    ligadas = new Set([AQUI, LA]);
    trilhaFalha = false;
    const antes = await trilhasLa();
    const r = await acesso.abrir(sessao(), m.pa, LA, PEDIDO, null);
    expect(r).toMatchObject({ estabelecimento: LA, idRemoto: m.pb, pagina: 1, temMais: false });
    expect(r.eventos).toHaveLength(1);
    expect(ordem).toEqual([`exigir:${LA}:${m.pb}`, `trilha:${LA}`, `linha:${LA}:${m.pb}`]);
    expect(await trilhasLa()).toBe(antes + 1);
    const t = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `conta-${P}` }, (l) =>
      l.uma<{ entidade_id: unknown; usuario_id: unknown; evento: unknown }>(
        `SELECT entidade_id, usuario_id, JSON_VALUE(dados_depois, '$.evento') AS evento
           FROM trilha_auditoria WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 1`,
        [m.estLa],
      ),
    );
    // O login da sessão não é provadamente a mesma pessoa lá: a trilha fica sem usuário (falha fechada).
    expect({ entidade: Number(t?.entidade_id), usuario: t?.usuario_id ?? null, evento: t?.evento }).toEqual({
      entidade: m.pb,
      usuario: null,
      evento: EVENTOS_AUDITAVEIS.prontuarioRedeLido.codigo,
    });
  });

  it('regra 7: sem trilha, sem dado (503 e a linha do tempo não é lida)', async () => {
    ordem = [];
    ligadas = new Set([AQUI, LA]);
    trilhaFalha = true;
    expect(await recusa(acesso.abrir(sessao(), m.pa, LA, PEDIDO, null))).toMatchObject({ status: 503 });
    expect(ordem).toEqual([`exigir:${LA}:${m.pb}`, `trilha:${LA}`]);
    trilhaFalha = false;
  });
});
