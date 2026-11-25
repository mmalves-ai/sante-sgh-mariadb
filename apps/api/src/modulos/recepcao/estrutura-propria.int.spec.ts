// 02-REC linha 33, contrato de efeito: o hospital monta a recepção pela tela e o que fica no banco do cliente.
//   - ponto de recepção novo em ponto_recepcao (estabelecimento da sessão, ativo), com a trilha da inclusão;
//   - guichês em guiche_recepcao (número único no ponto, mesmo com o outro inativo);
//   - serviço de senha em gerador_senha (prefixo único no ponto, grupo de prioridade legal pelo código, limite do dia
//     e posição do botão), e a operação diária já emite senha nele (recepcao.emitirSenha);
//   - a leitura devolve os botões na ordem da posição; a alteração troca os campos, sobe a versão e recusa a versão
//     antiga; o registro de outro estabelecimento não é alcançado;
//   - desativar nunca apaga: grava ativo = FALSE com o motivo na trilha, e é recusado com guichê aberto ou com
//     senha de hoje ainda em aberto.
// Massa SINTÉTICA da recepção (rc0101a), limpa antes e depois. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AutorEstrutura } from './estrutura-porta.js';
import { EstruturaRecepcaoPropria } from './estrutura-propria.js';
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
const autor = (): AutorEstrutura => ({ login: LOGIN, correlacao: `f3203-${randomUUID()}`.slice(0, 40) });
const PREFIXO = 'F3203-';

/** O código da recusa (ErroOperacao do núcleo) ou 'aceitou'. */
async function recusada(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'aceitou';
  } catch (e) {
    return String((e as { problema?: { codigo?: string } }).problema?.codigo ?? (e as Error).message);
  }
}

describe.skipIf(SEM_BANCO)('02-REC 33: cadastro da estrutura da recepção (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let estrutura: EstruturaRecepcaoPropria;
  let recepcao: PortaRecepcaoPropria;
  let m: Massa;
  let ponto = 0;
  let guiche = 0;
  let servico = 0;

  const ler = <T>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia-f3203' }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );
  const limparEstrutura = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f3203' }, async (e) => {
      const pontos = `SELECT id FROM ponto_recepcao WHERE estabelecimento_id IN (?, ?) AND codigo LIKE '${PREFIXO}%'`;
      const ests = [m.est, m.outroEst];
      await e.executar(`DELETE FROM gerador_senha WHERE ponto_recepcao_id IN (${pontos})`, ests);
      await e.executar(`DELETE FROM guiche_recepcao WHERE ponto_recepcao_id IN (${pontos})`, ests);
      await e.executar(
        `DELETE FROM ponto_recepcao WHERE estabelecimento_id IN (?, ?) AND codigo LIKE '${PREFIXO}%'`,
        ests,
      );
    });
  const trilha = (tabela: string, id: number) =>
    ler<{ acao: string; motivo: string | null }>(
      'SELECT acao, motivo FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ? ORDER BY id',
      [tabela, id],
    );
  const pontoLido = async () => (await estrutura.ler(c)).pontos.find((p) => p.id === ponto)!;

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    await limparMovimento(nucleo, m);
    await limparEstrutura();
    estrutura = new EstruturaRecepcaoPropria(nucleo, CLIENTE);
    recepcao = new PortaRecepcaoPropria(nucleo, nucleo.criarExecutor(), CLIENTE);
  });
  afterAll(async () => {
    if (m) {
      await limparMovimento(nucleo, m);
      await limparEstrutura();
    }
    await nucleo?.encerrar();
  });

  it('inclui o ponto de recepção no estabelecimento da sessão, com a trilha; recusa o código repetido', async () => {
    ponto = await estrutura.incluirPonto(c, autor(), {
      codigo: `${PREFIXO}NOVA`,
      descricao: 'Recepção sintética F3203',
      textoSenha: 'Aguarde a chamada no painel',
    });
    const [linha] = await ler<{
      estabelecimento_id: number;
      ativo: number;
      versao: number;
      criado_por: number;
    }>(
      'SELECT estabelecimento_id, ativo, versao, criado_por, texto_impressao_senha FROM ponto_recepcao WHERE id = ?',
      [ponto],
    );
    expect(Number(linha!.estabelecimento_id)).toBe(m.est);
    expect(Boolean(linha!.ativo)).toBe(true);
    expect(Number(linha!.criado_por)).toBe(m.usuario);
    expect(linha!['texto_impressao_senha']).toBe('Aguarde a chamada no painel');
    expect((await trilha('ponto_recepcao', ponto)).map((t) => t.acao)).toEqual(['inclusao']);
    expect(
      await recusada(
        estrutura.incluirPonto(c, autor(), {
          codigo: `${PREFIXO}nova`,
          descricao: 'Outra recepção sintética F3203',
          textoSenha: null,
        }),
      ),
    ).toBe('codigo-repetido');
    // O mesmo código em outro estabelecimento não colide (a unicidade é por estabelecimento).
    const noOutro = await estrutura.incluirPonto(outro, autor(), {
      codigo: `${PREFIXO}NOVA`,
      descricao: 'Recepção sintética F3203',
      textoSenha: null,
    });
    const [o] = await ler<{ estabelecimento_id: number }>(
      'SELECT estabelecimento_id FROM ponto_recepcao WHERE id = ?',
      [noOutro],
    );
    expect(Number(o!.estabelecimento_id)).toBe(m.outroEst);
    // E o ponto do outro estabelecimento não é alcançado pela sessão deste.
    expect(
      await recusada(
        estrutura.alterarPonto(c, autor(), noOutro, {
          codigo: `${PREFIXO}X`,
          descricao: 'Tentativa cruzada',
          textoSenha: null,
          versao: 1,
        }),
      ),
    ).toBe('nao-encontrado');
  });

  it('altera o ponto, sobe a versão e recusa a versão antiga', async () => {
    await estrutura.alterarPonto(c, autor(), ponto, {
      codigo: `${PREFIXO}NOVA`,
      descricao: 'Recepção sintética F3203 (térreo)',
      textoSenha: null,
      versao: 1,
    });
    const p = await pontoLido();
    expect(p).toMatchObject({ descricao: 'Recepção sintética F3203 (térreo)', textoSenha: null, versao: 2 });
    expect(
      await recusada(
        estrutura.alterarPonto(c, autor(), ponto, {
          codigo: `${PREFIXO}NOVA`,
          descricao: 'Sobreposição',
          textoSenha: null,
          versao: 1,
        }),
      ),
    ).toBe('versao-desatualizada');
    expect((await trilha('ponto_recepcao', ponto)).map((t) => t.acao)).toEqual(['inclusao', 'alteracao']);
  });

  it('inclui guichês com número único no ponto e altera a descrição', async () => {
    guiche = await estrutura.incluirGuiche(c, autor(), ponto, { numero: 1, descricao: null });
    const segundo = await estrutura.incluirGuiche(c, autor(), ponto, {
      numero: 2,
      descricao: 'Preferencial',
    });
    expect(await recusada(estrutura.incluirGuiche(c, autor(), ponto, { numero: 2, descricao: null }))).toBe(
      'numero-repetido',
    );
    expect(await recusada(estrutura.incluirGuiche(c, autor(), ponto, { numero: 0, descricao: null }))).toBe(
      'numero-invalido',
    );
    await estrutura.alterarGuiche(c, autor(), guiche, { numero: 1, descricao: 'Balcão', versao: 1 });
    const linhas = await ler<{
      id: number;
      numero: number;
      descricao: string | null;
      ativo: number;
      versao: number;
    }>(
      'SELECT id, numero, descricao, ativo, versao FROM guiche_recepcao WHERE ponto_recepcao_id = ? ORDER BY numero',
      [ponto],
    );
    expect(linhas.map((g) => [Number(g.id), Number(g.numero), g.descricao, Number(g.versao)])).toEqual([
      [guiche, 1, 'Balcão', 2],
      [segundo, 2, 'Preferencial', 1],
    ]);
    // Desativar o guichê 2 guarda a linha (nunca apaga) e o número continua reservado.
    await estrutura.situacao(c, autor(), 'guiche', segundo, {
      ativo: false,
      motivo: 'Guichê retirado do balcão',
      versao: 1,
    });
    expect(await recusada(estrutura.incluirGuiche(c, autor(), ponto, { numero: 2, descricao: null }))).toBe(
      'numero-repetido',
    );
    expect((await pontoLido()).guiches.map((g) => [g.numero, g.ativo])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(await trilha('guiche_recepcao', segundo)).toEqual([
      { acao: 'inclusao', motivo: null },
      { acao: 'alteracao', motivo: 'Guichê retirado do balcão' },
    ]);
  });

  it('inclui serviços de senha com grupo de prioridade legal e posição; a leitura vem na ordem dos botões', async () => {
    servico = await estrutura.incluirServico(c, autor(), ponto, {
      prefixo: 'ZC',
      descricao: 'Consultas sintéticas',
      tipo: 'geral',
      prioritaria: false,
      grupoPrioridade: null,
      limiteDia: 200,
      ordemBotao: 2,
    });
    const preferencial = await estrutura.incluirServico(c, autor(), ponto, {
      prefixo: 'ZP',
      descricao: 'Preferencial sintético',
      tipo: 'geral',
      prioritaria: true,
      grupoPrioridade: 'gestante',
      limiteDia: null,
      ordemBotao: 1,
    });
    const [g] = await ler<{ id: number }>("SELECT id FROM grupo_prioridade_legal WHERE codigo = 'gestante'");
    const [linha] = await ler<Record<string, unknown>>(
      `SELECT ponto_recepcao_id, prefixo, tipo, gera_prioritaria, grupo_prioridade_legal_id, limite_dia, ordem_botao, ativo
         FROM gerador_senha WHERE id = ?`,
      [preferencial],
    );
    expect(Number(linha!['ponto_recepcao_id'])).toBe(ponto);
    expect(linha!['prefixo']).toBe('ZP');
    expect(Boolean(linha!['gera_prioritaria'])).toBe(true);
    expect(Number(linha!['grupo_prioridade_legal_id'])).toBe(Number(g!.id));
    expect(linha!['limite_dia']).toBeNull();
    expect(Number(linha!['ordem_botao'])).toBe(1);
    const base = {
      tipo: 'geral',
      prioritaria: false,
      grupoPrioridade: null,
      limiteDia: null,
      ordemBotao: null,
    };
    expect(
      await recusada(
        estrutura.incluirServico(c, autor(), ponto, {
          ...base,
          prefixo: 'ZC',
          descricao: 'Exames sintéticos',
        }),
      ),
    ).toBe('prefixo-repetido');
    expect(
      await recusada(
        estrutura.incluirServico(c, autor(), ponto, {
          ...base,
          prefixo: 'ZX',
          descricao: 'Exames sintéticos',
          grupoPrioridade: 'gestante',
        }),
      ),
    ).toBe('grupo-sem-prioridade');
    expect((await pontoLido()).servicos.map((s) => s.prefixo)).toEqual(['ZP', 'ZC']);
    // A porta da operação diária enxerga a recepção nova com os botões na mesma ordem.
    const naOperacao = (await recepcao.recepcoes(c)).find((r) => r.id === ponto)!;
    expect(naOperacao.guiches).toEqual([1]);
    expect(naOperacao.geradores.map((x) => x.letra)).toEqual(['ZP', 'ZC']);
    // Alterar troca os campos e a posição, e a ordem acompanha.
    await estrutura.alterarServico(c, autor(), servico, {
      prefixo: 'ZC',
      descricao: 'Consultas sintéticas',
      tipo: 'geral',
      prioritaria: false,
      grupoPrioridade: null,
      limiteDia: 150,
      ordemBotao: null,
      versao: 1,
    });
    const [depois] = await ler<{ limite_dia: number; ordem_botao: number | null; versao: number }>(
      'SELECT limite_dia, ordem_botao, versao FROM gerador_senha WHERE id = ?',
      [servico],
    );
    expect([Number(depois!.limite_dia), depois!.ordem_botao, Number(depois!.versao)]).toEqual([150, null, 2]);
    expect((await trilha('gerador_senha', servico)).map((t) => t.acao)).toEqual(['inclusao', 'alteracao']);
  });

  it('o serviço novo já emite senha; com senha de hoje em aberto ou guichê aberto, desativar é recusado', async () => {
    const chave = `f3203-${randomUUID()}`;
    const emitida = await recepcao.executar(
      c,
      'recepcao.emitirSenha',
      { gerador: servico, prioridade: '2', origem: 'balcao' },
      { login: LOGIN, correlacao: chave.slice(0, 40), chaveIdempotencia: chave },
    );
    expect(Number(emitida.resultado['senha'])).toBeGreaterThan(0);
    const v = (await pontoLido()).servicos.find((s) => s.id === servico)!.versao;
    expect(
      await recusada(
        estrutura.situacao(c, autor(), 'servico', servico, {
          ativo: false,
          motivo: 'Serviço encerrado',
          versao: v,
        }),
      ),
    ).toBe('senha-em-aberto');
    const vp = (await pontoLido()).versao;
    expect(
      await recusada(
        estrutura.situacao(c, autor(), 'ponto', ponto, {
          ativo: false,
          motivo: 'Recepção fechada',
          versao: vp,
        }),
      ),
    ).toBe('senha-em-aberto');
    // Guichê aberto na recepção da massa: nem o guichê nem a recepção podem ser desativados.
    const chave2 = `f3203-${randomUUID()}`;
    await recepcao.executar(
      c,
      'recepcao.abrirGuiche',
      { recepcao: m.recepcao, local: m.local, guiche: 1 },
      { login: LOGIN, correlacao: chave2.slice(0, 40), chaveIdempotencia: chave2 },
    );
    const massa = (await estrutura.ler(c)).pontos.find((p) => p.id === m.recepcao)!;
    const g1 = massa.guiches.find((x) => x.id === m.guiche1)!;
    expect(g1.aberto).toBe(true);
    expect(
      await recusada(
        estrutura.situacao(c, autor(), 'guiche', g1.id, {
          ativo: false,
          motivo: 'Guichê em reforma',
          versao: g1.versao,
        }),
      ),
    ).toBe('guiche-aberto');
    expect(
      await recusada(
        estrutura.situacao(c, autor(), 'ponto', massa.id, {
          ativo: false,
          motivo: 'Recepção em reforma',
          versao: massa.versao,
        }),
      ),
    ).toBe('guiche-aberto');
    const [ainda] = await ler<{ ativo: number }>('SELECT ativo FROM gerador_senha WHERE id = ?', [servico]);
    expect(Boolean(ainda!.ativo)).toBe(true);
  });

  it('sem uso em curso, desativa com motivo na trilha, guarda a linha e reativa', async () => {
    await limparMovimento(nucleo, m);
    const s = (await pontoLido()).servicos.find((x) => x.id === servico)!;
    await estrutura.situacao(c, autor(), 'servico', servico, {
      ativo: false,
      motivo: 'Serviço encerrado no teste',
      versao: s.versao,
    });
    const [linha] = await ler<{ ativo: number; versao: number }>(
      'SELECT ativo, versao FROM gerador_senha WHERE id = ?',
      [servico],
    );
    expect([Boolean(linha!.ativo), Number(linha!.versao)]).toEqual([false, s.versao + 1]);
    expect((await trilha('gerador_senha', servico)).at(-1)).toEqual({
      acao: 'alteracao',
      motivo: 'Serviço encerrado no teste',
    });
    await estrutura.situacao(c, autor(), 'servico', servico, {
      ativo: true,
      motivo: null,
      versao: s.versao + 1,
    });
    const p = await pontoLido();
    expect(p.servicos.find((x) => x.id === servico)!.ativo).toBe(true);
    await estrutura.situacao(c, autor(), 'ponto', ponto, {
      ativo: false,
      motivo: 'Recepção desativada no teste',
      versao: p.versao,
    });
    const [pl] = await ler<{ ativo: number; excluido_em: Date | null }>(
      'SELECT ativo, excluido_em FROM ponto_recepcao WHERE id = ?',
      [ponto],
    );
    expect([Boolean(pl!.ativo), pl!.excluido_em]).toEqual([false, null]);
    // A recepção desativada sai da operação diária e continua no cadastro, com os guichês e os serviços guardados.
    expect((await recepcao.recepcoes(c)).some((r) => r.id === ponto)).toBe(false);
    const guardado = await pontoLido();
    expect([guardado.ativo, guardado.guiches.length, guardado.servicos.length]).toEqual([false, 2, 2]);
  });
});
