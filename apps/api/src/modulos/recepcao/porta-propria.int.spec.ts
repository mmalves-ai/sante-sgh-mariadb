// Integração da porta PRÓPRIA da recepção contra o MariaDB real (cliente de teste da onda, f22_o1), com massa
// SINTÉTICA (massa-recepcao.spec-util.ts): o contrato de efeito de cada operação (linhas, versão, trilha, outbox e
// idempotência na mesma transação) e as recusas (guichê de outro, entrada inválida, outro estabelecimento, conflito).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaGuiasPropria } from './aplicacao/worklist-recepcao.js';
import {
  CLIENTE,
  CODIGO_EST,
  CODIGO_OUTRO,
  garantirCliente,
  hojeSP,
  limparMovimento,
  LOGIN,
  LOGIN2,
  type Massa,
  montarMassa,
  SEM_BANCO,
} from './massa-recepcao.spec-util.js';
import { PortaRecepcaoPropria } from './porta-propria.js';
import type { ContextoGravacao } from './tipos.js';

const c = { rede: 'rede-teste', hospital: CODIGO_EST };
const outro = { rede: 'rede-teste', hospital: CODIGO_OUTRO };
const g = (login = LOGIN, chave = `rc0101-${randomUUID()}`): ContextoGravacao => ({
  login,
  correlacao: `rc0101-${chave.slice(-12)}`,
  chaveIdempotencia: chave,
});

async function recusada(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e.problema.codigo ?? '';
    throw e;
  }
  throw new Error('a gravação deveria ser recusada');
}

describe.skipIf(SEM_BANCO)('porta própria da recepção contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRecepcaoPropria;
  let m: Massa;
  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-rc0101' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    await limparMovimento(nucleo, m);
    porta = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
  });
  afterAll(async () => {
    if (m) await limparMovimento(nucleo, m);
    await nucleo?.encerrar();
  });

  it('lê a recepção do estabelecimento: locais, serviços (tipo neutro, sem limite = null) e guichês', async () => {
    const rs = await porta.recepcoes(c);
    expect(rs).toHaveLength(1);
    const r = rs[0]!;
    expect(r.id).toBe(m.recepcao);
    expect(r.guiches).toEqual([1, 2]);
    expect(r.geradores.find((x) => x.id === m.gerador)).toMatchObject({
      letra: 'RC',
      tipo: 'atendimento',
      prioritaria: true,
      limiteDia: 50,
      ordem: 'prioridade',
      tempoAlvoMinutos: null,
    });
    expect(r.geradores.find((x) => x.id === m.geradorDiverso)).toMatchObject({
      tipo: 'diverso',
      limiteDia: null,
    });
    expect(r.locais.find((x) => x.id === m.local)?.encaminha).toEqual([m.local2]);
    // O outro estabelecimento não vê a recepção deste.
    expect((await porta.recepcoes(outro)).map((x) => x.id)).not.toContain(m.recepcao);
    const rel = await porta.relogio(c);
    expect(rel.hoje).toBe(hojeSP());
  });

  it('abre o guichê: a ocupação, a trilha e a idempotência; outra pessoa é recusada', async () => {
    const ctx = g();
    const r = await porta.executar(
      c,
      'recepcao.abrirGuiche',
      { recepcao: m.recepcao, local: m.local, guiche: 1 },
      ctx,
    );
    expect(r.repetida).toBe(false);
    expect(r.trilha).toBeGreaterThan(0);
    const oc = await ler<{ versao: number; fim_em: Date | null }>(
      'SELECT versao, fim_em FROM ocupacao_guiche WHERE guiche_recepcao_id = ? AND fim_em IS NULL',
      [m.guiche1],
    );
    expect(oc).toHaveLength(1);
    expect(Number(oc[0]!.versao)).toBe(1);
    const t = await ler<{ entidade: string; correlacao: string }>(
      'SELECT entidade, correlacao FROM trilha_auditoria WHERE id = ?',
      [r.trilha],
    );
    expect(t[0]).toMatchObject({ entidade: 'ocupacao_guiche', correlacao: ctx.correlacao });
    // Mesma chave e mesma entrada: o resultado da primeira, sem gravar de novo.
    const rep = await porta.executar(
      c,
      'recepcao.abrirGuiche',
      { recepcao: m.recepcao, local: m.local, guiche: 1 },
      ctx,
    );
    expect(rep.repetida).toBe(true);
    expect(
      await recusada(
        porta.executar(
          c,
          'recepcao.abrirGuiche',
          { recepcao: m.recepcao, local: m.local, guiche: 1 },
          g(LOGIN2),
        ),
      ),
    ).toBe('guiche-ocupado');
    expect(guicheEmUso(await porta.guichesEmUso(c))).toEqual([
      { recepcao: m.recepcao, local: m.local, guiche: 1, usuario: LOGIN },
    ]);
  });

  it('emite senhas (número do dia por serviço, prioridade pelo grupo) e chama a prioritária primeiro', async () => {
    const e1 = await porta.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
      g(),
    );
    const e2 = await porta.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: m.gerador, prioridade: '1', grupo: 4, origem: 'balcao' },
      g(),
    );
    expect(Number(e2.resultado['numero'])).toBe(Number(e1.resultado['numero']) + 1);
    const linhas = await ler<{
      numero: number;
      prioritaria: number;
      data_referencia: Date;
      situacao: string;
      codigo_exibicao: string;
    }>(
      'SELECT numero, prioritaria, data_referencia, situacao, codigo_exibicao FROM senha_emitida WHERE estabelecimento_id = ? ORDER BY numero',
      [m.est],
    );
    expect(linhas.map((x) => x.situacao)).toEqual(['aguardando', 'aguardando']);
    expect(linhas[0]!.codigo_exibicao).toBe('RC 001');
    expect(linhas.map((x) => Boolean(Number(x.prioritaria)))).toEqual([false, true]);
    // A prioritária é chamada primeiro (ordem do domínio), com o evento do fluxo, a versão e o outbox.
    const ch = await porta.executar(
      c,
      'recepcao.chamarSenha',
      { recepcao: m.recepcao, local: m.local, guiche: 1, geradores: [m.gerador] },
      g(),
    );
    expect(ch.resultado['senha']).toBe(e2.resultado['senha']);
    const s = await porta.senha(c, Number(ch.resultado['senha']));
    expect(s).toMatchObject({
      situacao: 'chamada',
      guiche: 1,
      chamadas: 1,
      prioritaria: true,
      grupo: 'gestante',
      origem: 'balcao',
    });
    expect(s?.chamadaEm).toBeTruthy();
    const v = await ler<{ versao: number }>('SELECT versao FROM senha_emitida WHERE id = ?', [
      ch.resultado['senha'],
    ]);
    expect(Number(v[0]!.versao)).toBe(2);
    const ev = await ler<{ n: number }>('SELECT COUNT(*) AS n FROM evento_senha WHERE senha_emitida_id = ?', [
      ch.resultado['senha'],
    ]);
    expect(Number(ev[0]!.n)).toBe(1);
    const out = await ler<{ ponto: string }>(
      "SELECT ponto FROM integracao_mensagem WHERE entidade = 'senha_emitida' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [ch.resultado['senha']],
    );
    expect(out[0]?.ponto).toBe('recepcao.senha_chamada');
    // A fila do dia lê as duas, com a chamada no guichê; a que falta à frente é contada.
    const dia = await porta.senhasDoDia(c, { recepcao: m.recepcao });
    expect(dia.senhas).toHaveLength(2);
    expect(await porta.aFrente(c, Number(e1.resultado['senha']))).toBe(0);
    // Rechamar soma uma chamada; outra pessoa (sem o guichê) é recusada.
    await porta.executar(
      c,
      'recepcao.registrarEventoSenha',
      { senha: Number(ch.resultado['senha']), evento: 'rechamar', local: m.local, guiche: 1 },
      g(),
    );
    expect((await porta.senha(c, Number(ch.resultado['senha'])))?.chamadas).toBe(2);
    expect(
      await recusada(
        porta.executar(
          c,
          'recepcao.registrarEventoSenha',
          { senha: Number(ch.resultado['senha']), evento: 'rechamar', local: m.local, guiche: 1 },
          g(LOGIN2),
        ),
      ),
    ).toBe('guiche-de-outro');
    // Suspender e "não localizado" esperam a situação "suspensa" no modelo: recusa explícita, nada muda.
    for (const ev of [{ evento: 'suspender', motivo: 'DOCUMENTO' }, { evento: 'naoLocalizado' }])
      expect(
        await recusada(
          porta.executar(
            c,
            'recepcao.registrarEventoSenha',
            { senha: Number(ch.resultado['senha']), local: m.local, guiche: 1, ...ev },
            g(),
          ),
        ),
      ).toBe('modelo-pendente');
    expect((await porta.senha(c, Number(ch.resultado['senha'])))?.situacao).toBe('chamada');
  });

  it('recusa a entrada inválida, a senha de outro estabelecimento e a mesma chave com outra entrada', async () => {
    expect(await recusada(porta.executar(c, 'recepcao.emitirSenha', { gerador: m.gerador }, g()))).toBe(
      'entrada-invalida',
    );
    const s = await porta.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
      g(),
    );
    expect(
      await recusada(
        porta.executar(
          outro,
          'recepcao.registrarChegada',
          { senha: Number(s.resultado['senha']), tipo: 'consulta', marcacao: m.marcacao },
          g(),
        ),
      ),
    ).toBe('registro-inexistente');
    const k = g();
    await porta.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
      k,
    );
    expect(
      await recusada(
        porta.executar(
          c,
          'recepcao.emitirSenha',
          { gerador: m.geradorDiverso, prioridade: '2', origem: 'balcao' },
          k,
        ),
      ),
    ).toBe('idempotencia-divergente');
  });

  it('registra e desfaz a chegada do agendado (vínculo, marcação e o motivo na trilha)', async () => {
    const s = await porta.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
      g(),
    );
    const senha = Number(s.resultado['senha']);
    const ag = await porta.agendados(c, { prontuario: m.prontuario });
    expect(ag.itens.map((x) => x.marcacao)).toContain(m.marcacao);
    await porta.executar(
      c,
      'recepcao.registrarChegada',
      { senha, tipo: 'consulta', marcacao: m.marcacao },
      g(),
    );
    const v = await ler<{ excluido_em: Date | null }>(
      'SELECT excluido_em FROM senha_emitida_marcacao WHERE senha_emitida_id = ?',
      [senha],
    );
    expect(v).toHaveLength(1);
    const mh = await ler<{ chegada_em: Date | null }>(
      'SELECT chegada_em FROM marcacao_horario WHERE id = ?',
      [m.marcacao],
    );
    expect(mh[0]!.chegada_em).not.toBeNull();
    // A situação da marcação passa à de significado "chegou", com o histórico do evento "chegada".
    const sit = await ler<{ significado: string }>(
      `SELECT sm.significado FROM marcacao_horario m JOIN situacao_marcacao sm ON sm.id = m.situacao_marcacao_id
        WHERE m.id = ?`,
      [m.marcacao],
    );
    expect(sit[0]!.significado).toBe('chegou');
    const hist = await ler<{ evento: string; situacao_marcacao_id: number }>(
      'SELECT evento, situacao_marcacao_id FROM marcacao_horario_historico WHERE marcacao_horario_id = ? ORDER BY id',
      [m.marcacao],
    );
    expect(hist.map((h) => h.evento)).toEqual(['chegada']);
    expect((await porta.senha(c, senha))?.agendamento).toBe(true);
    expect((await porta.pacientesDasSenhas(c, [senha])).get(senha)?.prontuario).toBe(m.prontuario);
    expect(
      await recusada(
        porta.executar(
          c,
          'recepcao.registrarChegada',
          { senha, tipo: 'consulta', marcacao: m.marcacao },
          g(),
        ),
      ),
    ).toBe('senha-ja-ligada');
    const d = await porta.executar(
      c,
      'recepcao.desfazerChegada',
      { senha, motivo: 'Chegada registrada por engano no teste' },
      g(),
    );
    const t = await ler<{ motivo: string }>('SELECT motivo FROM trilha_auditoria WHERE id = ?', [d.trilha]);
    expect(t[0]!.motivo).toBe('Chegada registrada por engano no teste');
    const depois = await ler<{ excluido_em: Date | null }>(
      'SELECT excluido_em FROM senha_emitida_marcacao WHERE senha_emitida_id = ?',
      [senha],
    );
    expect(depois[0]!.excluido_em).not.toBeNull();
    expect(
      (
        await ler<{ chegada_em: Date | null }>('SELECT chegada_em FROM marcacao_horario WHERE id = ?', [
          m.marcacao,
        ])
      )[0]!.chegada_em,
    ).toBeNull();
    // Desfazer devolve a situação anterior (a do histórico da chegada) e grava o histórico com o motivo.
    const volta = await ler<{ situacao_marcacao_id: number }>(
      'SELECT situacao_marcacao_id FROM marcacao_horario WHERE id = ?',
      [m.marcacao],
    );
    expect(Number(volta[0]!.situacao_marcacao_id)).toBe(m.situacaoMarcada);
    const hist2 = await ler<{ evento: string; justificativa: string | null }>(
      'SELECT evento, justificativa FROM marcacao_horario_historico WHERE marcacao_horario_id = ? ORDER BY id',
      [m.marcacao],
    );
    expect(hist2.map((h) => h.evento)).toEqual(['chegada', 'alteracao']);
    expect(hist2[1]!.justificativa).toBe('Chegada registrada por engano no teste');
  });

  it('recusa a chegada da marcação cancelada com mensagem de negócio (nada gravado)', async () => {
    const s = await porta.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: m.gerador, prioridade: '2', origem: 'balcao' },
      g(),
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'rc0101-cancela' }, (e) =>
      e.executar('UPDATE marcacao_horario SET situacao_marcacao_id = ? WHERE id = ?', [
        m.situacaoCancelada,
        m.marcacao,
      ]),
    );
    try {
      expect(
        await recusada(
          porta.executar(
            c,
            'recepcao.registrarChegada',
            { senha: Number(s.resultado['senha']), tipo: 'consulta', marcacao: m.marcacao },
            g(),
          ),
        ),
      ).toBe('marcacao-cancelada');
      const v = await ler<{ n: number }>(
        'SELECT COUNT(*) AS n FROM senha_emitida_marcacao WHERE senha_emitida_id = ?',
        [s.resultado['senha']],
      );
      expect(Number(v[0]!.n)).toBe(0);
    } finally {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'rc0101-cancela' }, (e) =>
        e.executar('UPDATE marcacao_horario SET situacao_marcacao_id = ? WHERE id = ?', [
          m.situacaoMarcada,
          m.marcacao,
        ]),
      );
    }
  });

  it('fecha o guichê (a ocupação termina; o histórico fica) e lê os indicadores do dia', async () => {
    await porta.executar(
      c,
      'recepcao.fecharGuiche',
      { recepcao: m.recepcao, local: m.local, guiche: 1 },
      g(),
    );
    expect(await porta.guichesEmUso(c)).toEqual([]);
    const oc = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM ocupacao_guiche WHERE guiche_recepcao_id = ? AND fim_em IS NOT NULL',
      [m.guiche1],
    );
    expect(Number(oc[0]!.n)).toBeGreaterThanOrEqual(1);
    const hoje = hojeSP();
    const ind = await porta.indicadores(c, hoje, hoje, m.recepcao);
    expect(ind.total).toBeGreaterThanOrEqual(4);
    expect(ind.tempos.some((x) => x.guiche === 1 && x.chamadaEm !== null)).toBe(true);
    expect(ind.porServico.find((x) => x.gerador === m.gerador)?.senhas).toBe(ind.total);
  });

  it('as gravações sem tabela no modelo respondem "modelo-pendente" e nada gravam', async () => {
    const trilha = {
      evento: 'recepcao.fila.configurada',
      recurso: 'recepcao.gerador',
      tabela: 'gerador_senha',
      id: m.gerador,
      login: LOGIN,
      correlacao: 'rc0101-fila',
    };
    expect(
      await recusada(
        porta.gravar(c, trilha, (x) =>
          x.gravarFilaCfg({
            gerador: m.gerador,
            recepcao: m.recepcao,
            ordem: 'chegada',
            intercalar: 2,
            tempoAlvoMinutos: 10,
            rotuloTotem: null,
            noTotem: true,
            usuario: LOGIN,
          }),
        ),
      ),
    ).toBe('modelo-pendente');
    expect(await porta.dispositivos()).toEqual([]);
  });

  it('as guias do dia aguardando autorização: fonte que exige guia e sem senha', async () => {
    const guias = portaGuiasPropria(nucleo, CLIENTE);
    const r = await guias.guias(c, hojeSP());
    expect(r.guias.map((x) => x.reg)).toContain(m.atendimento);
    expect(r.guias.find((x) => x.reg === m.atendimento)?.convenio).toBe('Convênio SINTETICO');
    expect((await guias.guias(outro, hojeSP())).guias.map((x) => x.reg)).not.toContain(m.atendimento);
  });
});

function guicheEmUso<T>(xs: readonly T[]): T[] {
  return [...xs];
}
