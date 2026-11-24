// Integração da porta própria da lista de trabalho de imagem sobre o MariaDB real (cliente f22_o5; lote F2.2 05-16).
// Contrato de efeito: o item nasce com o número de acesso da regra do domínio, a situação a enviar e a versão 1; o exame
// ganha o mesmo número; o evento `imagem.mwl` vai à fila comum de saída na mesma transação; o segundo pedido do mesmo
// exame não cria outro item; o exame de outro estabelecimento não é visto; sem chave de liberação, a geração segue o
// destino do ESTABELECIMENTO (parâmetro pacs.parceiroWorklist com o parceiro ativo e com o evento): o ciclo grava o item,
// o número de acesso e o evento só no estabelecimento com destino; sem parâmetro ou com o parceiro inativo, nada é
// gravado, e o outro estabelecimento do mesmo cliente nunca recebe nada pelo destino do primeiro; o
// exame sem modalidade ativa vira item 'sem_modalidade' sem evento e é promovido quando o cadastro ganha a modalidade; o item
// cancelado não trava o exame (novo item, nova geração, o número do exame acompanha o item vigente); o número de acesso
// que o exame já tem é reaproveitado no item. Massa
// sintética (estabelecimentos fo516 e fo516b, modalidade Z516; ids de paciente e atendimento fictícios com as chaves
// estrangeiras desligadas só na montagem). SGH_NUCLEO_SEM_BANCO=1 pula.
import { EVENTO_OUTBOX_MWL } from '@sgh/contratos';
import { accessionDoItem } from '@sgh/dominio-sadt';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  inserirSintetico,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import { PortaWorklistPropria } from './pacs-worklist-propria.js';
import { cicloWorklist } from './pacs-worklist.service.js';

const H = 'fo516';
const H2 = 'fo516b';

describe.skipIf(SEM_BANCO)('lista de trabalho de imagem sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaWorklistPropria;
  const m = {
    est: 0,
    est2: 0,
    mod: 0,
    modInativa: 0,
    setor: 0,
    exame: 0,
    exameSem: 0,
    req: 0,
    req2: 0,
    item: 0,
    item2: 0,
    itemSem: 0,
    itemNum: 0,
    req3: 0,
    item3: 0,
    definicao: 0,
  };

  async function limpar(): Promise<void> {
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const ests = [m.est, m.est2];
      await e.executar(
        "DELETE FROM integracao_mensagem WHERE estabelecimento_id IN (?, ?) AND ponto = 'imagem.mwl'",
        ests,
      );
      await e.executar('DELETE FROM item_lista_trabalho_imagem WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar(
        `DELETE pv FROM parametro_valor pv JOIN parametro_definicao d ON d.id = pv.parametro_definicao_id
          WHERE d.chave = 'pacs.parceiroWorklist' AND pv.estabelecimento_id IN (?, ?)`,
        ests,
      );
      await e.executar(
        'DELETE ei FROM exame_item ei JOIN requisicao_exame q ON q.id = ei.requisicao_exame_id WHERE q.estabelecimento_id IN (?, ?)',
        ests,
      );
      await e.executar('DELETE FROM requisicao_exame WHERE estabelecimento_id IN (?, ?)', ests);
      await e.executar("DELETE FROM exame WHERE codigo IN ('F516X', 'F516Y')");
      await e.executar("DELETE FROM modalidade_imagem WHERE codigo IN ('F516', 'F516I')");
      await e.executar("DELETE FROM parceiro_dados WHERE codigo = 'F516PACS'");
      if (m.setor) await e.executar('DELETE FROM setor_diagnostico WHERE id = ?', [m.setor]);
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, async (e) => {
      m.est = await garantirEstabelecimento(e, H);
      m.est2 = await garantirEstabelecimento(e, H2);
    });
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      const agora = new Date();
      m.mod = await inserirSintetico(e, 'modalidade_imagem', {
        codigo: 'F516',
        descricao: 'Modalidade sintética 05-16',
        sigla_padrao: 'Z516',
        ativo: 1,
        criado_em: agora,
      });
      m.setor = await inserirSintetico(e, 'setor_diagnostico', {
        estabelecimento_id: m.est,
        tipo: 'imagem',
        canal_aviso_paciente: 'nenhum',
        ativo: 1,
        criado_em: agora,
      });
      m.exame = await inserirSintetico(e, 'exame', {
        codigo: 'F516X',
        sigla: 'F516X',
        nome: 'Exame sintético 05-16',
        modalidade_imagem_id: m.mod,
        tipo_servico: 'imagem',
        tipo_resultado: 'laudo',
        ativo: 1,
        criado_em: agora,
      });
      // O modelo exige modalidade no exame de imagem (ck_exame_imagem): o caso real é a modalidade inativa.
      m.modInativa = await inserirSintetico(e, 'modalidade_imagem', {
        codigo: 'F516I',
        descricao: 'Modalidade sintética 05-16 inativa',
        sigla_padrao: 'Z51I',
        ativo: 0,
        criado_em: agora,
      });
      m.exameSem = await inserirSintetico(e, 'exame', {
        codigo: 'F516Y',
        sigla: 'F516Y',
        nome: 'Exame sintético 05-16 com modalidade inativa',
        modalidade_imagem_id: m.modInativa,
        tipo_servico: 'imagem',
        tipo_resultado: 'laudo',
        ativo: 1,
        criado_em: agora,
      });
      const req = (est: number, numero: string) =>
        inserirSintetico(e, 'requisicao_exame', {
          estabelecimento_id: est,
          numero,
          paciente_id: 9_905_161,
          atendimento_id: 9_905_161,
          setor_diagnostico_id: m.setor,
          solicitante_profissional_id: 9_905_161,
          fonte_pagadora_id: 9_905_161,
          prioridade: 'urgente',
          solicitado_em: agora,
          criado_em: agora,
        });
      m.req = await req(m.est, 'F516-1');
      m.req2 = await req(m.est2, 'F516-2');
      const item = (r: number, sequencia = 1, exameId = m.exame, numero: string | null = null) =>
        inserirSintetico(e, 'exame_item', {
          requisicao_exame_id: r,
          sequencia,
          exame_id: exameId,
          situacao: 'solicitado',
          numero_acesso: numero,
          criado_em: agora,
        });
      m.item = await item(m.req);
      m.item2 = await item(m.req2);
      m.itemSem = await item(m.req, 2, m.exameSem);
      m.itemNum = await item(m.req, 3, m.exame, 'F516MIG0001');
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    porta = new PortaWorklistPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await limpar();
    await nucleo.encerrar();
  });

  const janela = () => ({ desde: new Date(Date.now() - 86_400_000), ate: new Date(Date.now() + 60_000) });

  it('lê os exames de imagem sem item, só do estabelecimento', async () => {
    const { desde, ate } = janela();
    const r = await porta.examesSemItem(H, desde, ate, 500);
    expect(r.cortada).toBe(false);
    const x = r.itens.find((i) => i.exame === m.item);
    expect(x).toMatchObject({
      exame: m.item,
      urgente: true,
      modalidade: { id: m.mod, sigla: 'Z516', ativa: true },
    });
    expect(r.itens.some((i) => i.exame === m.item2)).toBe(false);
  });

  it('cria o item com o número de acesso, o número no exame e o evento; o segundo pedido não duplica', async () => {
    const { desde, ate } = janela();
    const x = (await porta.examesSemItem(H, desde, ate, 500)).itens.find((i) => i.exame === m.item)!;
    const r = await porta.registrarItem(H, x, { id: m.mod, sigla: 'Z516' });
    expect(r).not.toBeNull();
    expect(r!.accession).toBe(accessionDoItem(H, r!.id));
    const efeito = await escrever(nucleo, async (e) => ({
      item: await e.uma(
        'SELECT estabelecimento_id, exame_item_id, modalidade_imagem_id, numero_acesso, situacao, forma_envio, versao FROM item_lista_trabalho_imagem WHERE id = ?',
        [r!.id],
      ),
      exame: await e.uma('SELECT numero_acesso, versao FROM exame_item WHERE id = ?', [m.item]),
      eventos: await e.consultar(
        "SELECT conteudo FROM integracao_mensagem WHERE estabelecimento_id = ? AND ponto = 'imagem.mwl' AND situacao = 'pendente'",
        [m.est],
      ),
    }));
    expect(efeito.item).toMatchObject({
      estabelecimento_id: m.est,
      exame_item_id: m.item,
      modalidade_imagem_id: m.mod,
      numero_acesso: r!.accession,
      situacao: 'a_enviar',
      forma_envio: 'automatico',
      versao: 1,
    });
    expect(efeito.exame).toMatchObject({ numero_acesso: r!.accession, versao: 2 });
    expect(efeito.eventos).toHaveLength(1);
    expect(JSON.parse(String(efeito.eventos[0]!['conteudo']))).toMatchObject({
      hospital: H,
      exame: m.item,
      item: r!.id,
    });
    expect(await porta.registrarItem(H, x, { id: m.mod, sigla: 'Z516' })).toBeNull();
    const n = await escrever(nucleo, (e) =>
      e.uma('SELECT COUNT(*) AS n FROM item_lista_trabalho_imagem WHERE exame_item_id = ?', [m.item]),
    );
    expect(Number(n!['n'])).toBe(1);
    expect((await porta.examesSemItem(H, desde, ate, 500)).itens.some((i) => i.exame === m.item)).toBe(false);
  });

  const efeitoItem = (id: number) =>
    escrever(nucleo, async (e) => ({
      item: await e.uma(
        'SELECT modalidade_imagem_id, numero_acesso, situacao, versao FROM item_lista_trabalho_imagem WHERE id = ?',
        [id],
      ),
      eventos: await e.consultar(
        "SELECT conteudo FROM integracao_mensagem WHERE estabelecimento_id = ? AND ponto = 'imagem.mwl' AND conteudo LIKE ?",
        [m.est, `%"item":${id}%`],
      ),
    }));

  it('exame sem modalidade ativa: item sem_modalidade sem evento, fora da releitura; com a modalidade no cadastro, promovido', async () => {
    const { desde, ate } = janela();
    const x = (await porta.examesSemItem(H, desde, ate, 500)).itens.find((i) => i.exame === m.itemSem)!;
    expect(x).toMatchObject({
      modalidade: { id: m.modInativa, ativa: false },
      geracao: 0,
      itemPendente: null,
    });
    const r = await porta.registrarItem(H, x, null);
    expect(r).toMatchObject({ situacao: 'sem_modalidade' });
    let ef = await efeitoItem(r!.id);
    expect(ef.item).toMatchObject({
      modalidade_imagem_id: null,
      situacao: 'sem_modalidade',
      numero_acesso: r!.accession,
    });
    expect(ef.eventos).toHaveLength(0);
    expect((await porta.examesSemItem(H, desde, ate, 500)).itens.some((i) => i.exame === m.itemSem)).toBe(
      false,
    );
    await escrever(nucleo, (e) =>
      e.executar('UPDATE exame SET modalidade_imagem_id = ? WHERE id = ?', [m.mod, m.exameSem]),
    );
    const y = (await porta.examesSemItem(H, desde, ate, 500)).itens.find((i) => i.exame === m.itemSem)!;
    expect(y).toMatchObject({ itemPendente: r!.id, modalidade: { id: m.mod } });
    const p = await porta.registrarItem(H, y, { id: m.mod, sigla: 'Z516' });
    expect(p).toEqual({ id: r!.id, accession: r!.accession, situacao: 'a_enviar' });
    ef = await efeitoItem(r!.id);
    expect(ef.item).toMatchObject({ modalidade_imagem_id: m.mod, situacao: 'a_enviar', versao: 2 });
    expect(ef.eventos).toHaveLength(1);
    expect((await porta.examesSemItem(H, desde, ate, 500)).itens.some((i) => i.exame === m.itemSem)).toBe(
      false,
    );
  });

  it('item cancelado: o exame volta, ganha item novo (nova geração) e o número do exame acompanha o item vigente', async () => {
    const { desde, ate } = janela();
    await escrever(nucleo, (e) =>
      e.executar("UPDATE item_lista_trabalho_imagem SET situacao = 'cancelado' WHERE exame_item_id = ?", [
        m.item,
      ]),
    );
    const x = (await porta.examesSemItem(H, desde, ate, 500)).itens.find((i) => i.exame === m.item)!;
    expect(x).toMatchObject({ geracao: 1, itemPendente: null });
    const r = await porta.registrarItem(H, x, { id: m.mod, sigla: 'Z516' });
    expect(r).toMatchObject({ situacao: 'a_enviar' });
    expect(r!.accession).toBe(accessionDoItem(H, r!.id));
    const exame = await escrever(nucleo, (e) =>
      e.uma('SELECT numero_acesso FROM exame_item WHERE id = ?', [m.item]),
    );
    expect(exame!['numero_acesso']).toBe(r!.accession);
    expect((await efeitoItem(r!.id)).eventos).toHaveLength(1);
    expect(await porta.registrarItem(H, x, { id: m.mod, sigla: 'Z516' })).toBeNull();
  });

  it('o exame que já tem número de acesso o reaproveita no item, sem segundo número', async () => {
    const { desde, ate } = janela();
    const x = (await porta.examesSemItem(H, desde, ate, 500)).itens.find((i) => i.exame === m.itemNum)!;
    const r = await porta.registrarItem(H, x, { id: m.mod, sigla: 'Z516' });
    expect(r).toMatchObject({ accession: 'F516MIG0001', situacao: 'a_enviar' });
    const exame = await escrever(nucleo, (e) =>
      e.uma('SELECT numero_acesso, versao FROM exame_item WHERE id = ?', [m.itemNum]),
    );
    expect(exame).toMatchObject({ numero_acesso: 'F516MIG0001', versao: 1 });
  });

  it('sem chave de liberação, o destino é do estabelecimento: o ciclo grava só onde o parceiro configurado está ativo', async () => {
    const agora = new Date();
    // Massa do caso: um exame novo no fo516 (os anteriores já viraram item) e o do fo516b, ainda sem item.
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      m.req3 = await inserirSintetico(e, 'requisicao_exame', {
        estabelecimento_id: m.est,
        numero: 'F516-3',
        paciente_id: 9_905_161,
        atendimento_id: 9_905_161,
        setor_diagnostico_id: m.setor,
        solicitante_profissional_id: 9_905_161,
        fonte_pagadora_id: 9_905_161,
        prioridade: 'rotina',
        solicitado_em: agora,
        criado_em: agora,
      });
      m.item3 = await inserirSintetico(e, 'exame_item', {
        requisicao_exame_id: m.req3,
        sequencia: 1,
        exame_id: m.exame,
        situacao: 'solicitado',
        criado_em: agora,
      });
      // O parceiro sintético nasce inativo, com o evento da lista.
      await e.executar(
        `INSERT INTO parceiro_dados (codigo, nome, tipo, escopos, eventos, limite_tentativas, finalidade, base_legal, ativo,
           criado_em) VALUES ('F516PACS', 'PACS sintético do teste', 'api', '[]', ?, 2, 'lista de trabalho de imagem',
           'tutela-da-saude', FALSE, NOW())`,
        [JSON.stringify([EVENTO_OUTBOX_MWL])],
      );
      // A definição do parâmetro (o catálogo de parâmetros a carrega no cliente; aqui garantida para o teste).
      const d = await e.uma("SELECT id FROM parametro_definicao WHERE chave = 'pacs.parceiroWorklist'", []);
      if (d) m.definicao = Number(d['id']);
      else {
        const mod =
          (await e.uma("SELECT id FROM modulo_sistema WHERE codigo = 'sadt'", [])) ??
          (await e.uma('SELECT MIN(id) AS id FROM modulo_sistema', []));
        m.definicao = await e.inserir(
          `INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, valor_padrao, permite_rede,
             permite_estabelecimento, criado_em)
           VALUES ('pacs.parceiroWorklist', ?, 'Parceiro que recebe a lista de trabalho do estabelecimento', 'texto', '',
             FALSE, TRUE, ?)`,
          [Number(mod!['id']), agora],
        );
      }
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    });
    const efeito = (exame: number, est: number) =>
      escrever(nucleo, async (e) => ({
        itens: await e.consultar(
          'SELECT numero_acesso, situacao FROM item_lista_trabalho_imagem WHERE exame_item_id = ? AND estabelecimento_id = ?',
          [exame, est],
        ),
        exame: await e.uma('SELECT numero_acesso FROM exame_item WHERE id = ?', [exame]),
        eventos: await e.consultar(
          `SELECT conteudo FROM integracao_mensagem WHERE estabelecimento_id = ? AND ponto = 'imagem.mwl'
            AND JSON_VALUE(conteudo, '$.exame') = ?`,
          [est, exame],
        ),
      }));
    const vazio = { itens: [], exame: { numero_acesso: null }, eventos: [] };

    // 1. Sem parâmetro no estabelecimento: nenhum destino, mesmo que o cliente tenha outro PACS ativo; nada gravado.
    expect(await porta.destinoConfigurado(H, agora)).toBeNull();
    expect(await cicloWorklist(porta, H, agora)).toMatchObject({ situacao: 'sem-destino', criados: 0 });
    expect(await efeito(m.item3, m.est)).toMatchObject(vazio);

    // 2. O fo516 aponta o parceiro sintético, ainda inativo: não é destino, nada gravado.
    await escrever(nucleo, (e) =>
      e.inserir(
        `INSERT INTO parametro_valor (parametro_definicao_id, nivel, estabelecimento_id, valor, vigencia_inicio, motivo, criado_em)
         VALUES (?, 'estabelecimento', ?, 'F516PACS', ?, 'teste do destino da lista de trabalho', ?)`,
        [m.definicao, m.est, new Date(agora.getTime() - 60_000), agora],
      ),
    );
    expect(await porta.destinoConfigurado(H, agora)).toBeNull();
    expect(await cicloWorklist(porta, H, agora)).toMatchObject({ situacao: 'sem-destino', criados: 0 });
    expect(await efeito(m.item3, m.est)).toMatchObject(vazio);

    // 3. Ativo: o fo516 gera o item, o número de acesso no exame e o evento na fila, sem nenhuma chave gravada.
    await escrever(nucleo, (e) =>
      e.executar("UPDATE parceiro_dados SET ativo = TRUE WHERE codigo = 'F516PACS'"),
    );
    expect(await porta.destinoConfigurado(H, agora)).toBe('F516PACS');
    const r = await cicloWorklist(porta, H, agora);
    expect(r.situacao).toBe('feito');
    expect(r.criados).toBeGreaterThanOrEqual(1);
    const gerado = await efeito(m.item3, m.est);
    expect(gerado.itens).toHaveLength(1);
    expect(gerado.itens[0]).toMatchObject({ situacao: 'a_enviar' });
    expect(gerado.exame).toMatchObject({ numero_acesso: gerado.itens[0]!['numero_acesso'] });
    expect(gerado.eventos).toHaveLength(1);
    expect(JSON.parse(String(gerado.eventos[0]!['conteudo']))).toMatchObject({ hospital: H, exame: m.item3 });

    // 4. O fo516b, do mesmo cliente, não tem destino: o PACS do fo516 não recebe o paciente dele.
    expect(await porta.destinoConfigurado(H2, agora)).toBeNull();
    expect(await cicloWorklist(porta, H2, agora)).toMatchObject({ situacao: 'sem-destino', criados: 0 });
    expect(await efeito(m.item2, m.est2)).toMatchObject(vazio);

    // Sem valor gravado, a janela é a do padrão da definição do parâmetro.
    expect(await porta.janelaDias(H2, new Date())).toBe(2);
  });
});
