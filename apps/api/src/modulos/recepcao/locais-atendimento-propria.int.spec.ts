// 02-REC linha 33 (C2-005), contrato de efeito: o hospital cadastra pela tela os locais de atendimento de cada
// recepção e os encaminhamentos entre eles, e o que fica no banco do cliente.
//   - local novo em local_atendimento (estabelecimento da sessão, recepção escolhida, ativo), com a trilha;
//   - código único no estabelecimento; a alteração troca os campos, sobe a versão e recusa a versão antiga; o local
//     de outro estabelecimento não é alcançado;
//   - os destinos vão para local_atendimento_encaminhamento; o que sai ganha excluido_em (a linha fica) e volta na
//     mesma linha; a operação do guichê passa a oferecer os destinos gravados;
//   - desligar o encaminhamento com destinos na lista é recusado;
//   - desativar nunca apaga: ativo = FALSE com o motivo na trilha, recusado com guichê aberto no local.
// Massa SINTÉTICA da recepção (rc0101a), limpa antes e depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AutorEstrutura } from './estrutura-porta.js';
import { LocaisAtendimentoPropria } from './locais-atendimento-propria.js';
import {
  CLIENTE,
  CODIGO_EST,
  CODIGO_OUTRO,
  garantirCliente,
  limparMovimento,
  LOGIN,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from './massa-recepcao.spec-util.js';
import { PortaRecepcaoPropria } from './porta-propria.js';

const c = { rede: 'rede-teste', hospital: CODIGO_EST };
const outro = { rede: 'rede-teste', hospital: CODIGO_OUTRO };
const autor = (): AutorEstrutura => ({ login: LOGIN, correlacao: `c2005-${randomUUID()}`.slice(0, 40) });
const PREFIXO = 'C2005-';

async function recusada(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'aceitou';
  } catch (e) {
    return String((e as { problema?: { codigo?: string } }).problema?.codigo ?? (e as Error).message);
  }
}

const novo = (codigo: string, descricao: string, permiteEncaminhamento = false) => ({
  codigo,
  descricao,
  permiteEncaminhamento,
  baseTempoEspera: false,
  reavaliacaoMedica: false,
  canalAudio: null,
});

describe.skipIf(SEM_BANCO)('02-REC 33 (C2-005): locais de atendimento e encaminhamentos (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let locais: LocaisAtendimentoPropria;
  let recepcao: PortaRecepcaoPropria;
  let m: Massa;
  let a = 0;
  let b = 0;

  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-c2005' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );
  const limpar = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c2005' }, async (e) => {
      const ids = `SELECT id FROM (SELECT id FROM local_atendimento WHERE estabelecimento_id IN (?, ?) AND codigo LIKE '${PREFIXO}%') x`;
      const ests = [m.est, m.outroEst];
      await e.executar(
        `DELETE FROM local_atendimento_encaminhamento WHERE local_atendimento_id IN (${ids}) OR destino_local_atendimento_id IN (${ids})`,
        [...ests, ...ests],
      );
      await e.executar(
        `DELETE FROM local_atendimento WHERE estabelecimento_id IN (?, ?) AND codigo LIKE '${PREFIXO}%'`,
        ests,
      );
    });
  const trilha = (tabela: string, id: number) =>
    ler<{ acao: string; motivo: string | null }>(
      'SELECT acao, motivo FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id',
      [tabela, id],
    );
  const lido = async (id: number) => (await locais.ler(c)).locais.find((x) => x.id === id)!;

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    await limparMovimento(nucleo, m);
    await limpar();
    locais = new LocaisAtendimentoPropria(nucleo, CLIENTE);
    recepcao = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
  });
  afterAll(async () => {
    if (m) {
      await limparMovimento(nucleo, m);
      await limpar();
    }
    await nucleo?.encerrar();
  });

  it('inclui o local na recepção do estabelecimento da sessão, com a trilha; recusa o código repetido', async () => {
    a = await locais.incluir(c, autor(), m.recepcao, {
      ...novo(`${PREFIXO}TRIAGEM`, 'Triagem sintética C2005', true),
      canalAudio: 'canal-2',
    });
    b = await locais.incluir(c, autor(), m.recepcao, novo(`${PREFIXO}SALA`, 'Sala sintética C2005'));
    const [linha] = await ler<Record<string, unknown>>(
      `SELECT estabelecimento_id, ponto_recepcao_id, ativo, versao, criado_por, permite_encaminhamento, canal_audio
         FROM local_atendimento WHERE id = ?`,
      [a],
    );
    expect([
      Number(linha!['estabelecimento_id']),
      Number(linha!['ponto_recepcao_id']),
      Boolean(linha!['ativo']),
      Number(linha!['versao']),
      Number(linha!['criado_por']),
      Boolean(linha!['permite_encaminhamento']),
      linha!['canal_audio'],
    ]).toEqual([m.est, m.recepcao, true, 1, m.usuario, true, 'canal-2']);
    expect((await trilha('local_atendimento', a)).map((t) => t.acao)).toEqual(['inclusao']);
    expect(
      await recusada(
        locais.incluir(c, autor(), m.recepcao, novo(`${PREFIXO.toLowerCase()}triagem`, 'Outra C2005')),
      ),
    ).toBe('codigo-repetido');
    // A recepção de outro estabelecimento não é alcançada.
    expect(
      await recusada(locais.incluir(outro, autor(), m.recepcao, novo(`${PREFIXO}X`, 'Fora C2005'))),
    ).toBe('nao-encontrado');
  });

  it('altera os campos, sobe a versão e recusa a versão antiga e o local de outro estabelecimento', async () => {
    const v = (await lido(b)).versao;
    await locais.alterar(c, autor(), b, {
      ...novo(`${PREFIXO}SALA`, 'Sala de medicação C2005'),
      baseTempoEspera: true,
      versao: v,
    });
    const depois = await lido(b);
    expect([depois.descricao, depois.baseTempoEspera, depois.versao]).toEqual([
      'Sala de medicação C2005',
      true,
      v + 1,
    ]);
    expect(
      await recusada(locais.alterar(c, autor(), b, { ...novo(`${PREFIXO}SALA`, 'Velha C2005'), versao: v })),
    ).toBe('versao-desatualizada');
    expect(
      await recusada(
        locais.alterar(outro, autor(), b, { ...novo(`${PREFIXO}SALA`, 'Fora C2005'), versao: v + 1 }),
      ),
    ).toBe('nao-encontrado');
    expect((await trilha('local_atendimento', b)).map((t) => t.acao)).toEqual(['inclusao', 'alteracao']);
  });

  it('grava os destinos, retira marcando excluido_em e devolve na mesma linha; o guichê passa a oferecê-los', async () => {
    let v = (await lido(a)).versao;
    await locais.destinos(c, autor(), a, { destinos: [b, m.local2], versao: v });
    expect((await lido(a)).destinos.sort()).toEqual([b, m.local2].sort());
    const daRecepcao = (await recepcao.recepcoes(c)).flatMap((r) => r.locais).find((l) => l.id === a)!;
    expect([...daRecepcao.encaminha].sort()).toEqual([b, m.local2].sort());
    v = (await lido(a)).versao;
    await locais.destinos(c, autor(), a, { destinos: [m.local2], versao: v });
    const pares = await ler<{ destino: number; excluido_em: Date | null; id: number }>(
      `SELECT id, destino_local_atendimento_id AS destino, excluido_em FROM local_atendimento_encaminhamento
        WHERE local_atendimento_id = ? ORDER BY destino_local_atendimento_id`,
      [a],
    );
    expect(pares.length).toBe(2);
    const retirado = pares.find((p) => Number(p.destino) === b)!;
    expect(retirado.excluido_em).not.toBeNull();
    v = (await lido(a)).versao;
    await locais.destinos(c, autor(), a, { destinos: [m.local2, b], versao: v });
    const [devolvido] = await ler<{ id: number; excluido_em: Date | null }>(
      `SELECT id, excluido_em FROM local_atendimento_encaminhamento
        WHERE local_atendimento_id = ? AND destino_local_atendimento_id = ?`,
      [a, b],
    );
    expect([Number(devolvido!.id), devolvido!.excluido_em]).toEqual([Number(retirado.id), null]);
    expect((await trilha('local_atendimento_encaminhamento', a)).length).toBe(3);
    v = (await lido(a)).versao;
    expect(await recusada(locais.destinos(c, autor(), a, { destinos: [a], versao: v }))).toBe(
      'destino-proprio',
    );
    // O local que não encaminha não recebe destinos, e o que encaminha não desliga com destinos na lista.
    const vb = (await lido(b)).versao;
    expect(await recusada(locais.destinos(c, autor(), b, { destinos: [a], versao: vb }))).toBe(
      'local-nao-encaminha',
    );
    expect(
      await recusada(
        locais.alterar(c, autor(), a, { ...novo(`${PREFIXO}TRIAGEM`, 'Triagem sintética C2005'), versao: v }),
      ),
    ).toBe('local-nao-encaminha');
  });

  it('desativar nunca apaga: recusado com guichê aberto; sem uso, grava o motivo e reativa', async () => {
    const chave = `c2005-${randomUUID()}`;
    await recepcao.executar(
      c,
      'recepcao.abrirGuiche',
      { recepcao: m.recepcao, local: m.local, guiche: 1 },
      { login: LOGIN, correlacao: chave.slice(0, 40), chaveIdempotencia: chave },
    );
    const l1 = await lido(m.local);
    expect(
      await recusada(
        locais.situacao(c, autor(), m.local, { ativo: false, motivo: 'Local em reforma', versao: l1.versao }),
      ),
    ).toBe('guiche-aberto');
    await limparMovimento(nucleo, m);
    const vb = (await lido(b)).versao;
    await locais.situacao(c, autor(), b, { ativo: false, motivo: 'Sala desativada no teste', versao: vb });
    const [linha] = await ler<{ ativo: number; excluido_em: Date | null; versao: number }>(
      'SELECT ativo, excluido_em, versao FROM local_atendimento WHERE id = ?',
      [b],
    );
    expect([Boolean(linha!.ativo), linha!.excluido_em, Number(linha!.versao)]).toEqual([false, null, vb + 1]);
    expect((await trilha('local_atendimento', b)).at(-1)).toEqual({
      acao: 'alteracao',
      motivo: 'Sala desativada no teste',
    });
    // O destino desativado que já estava na lista continua aceito; reativado, volta à operação.
    const va = (await lido(a)).versao;
    await locais.destinos(c, autor(), a, { destinos: [m.local2, b], versao: va });
    await locais.situacao(c, autor(), b, { ativo: true, motivo: null, versao: vb + 1 });
    expect((await lido(b)).ativo).toBe(true);
  });
});
