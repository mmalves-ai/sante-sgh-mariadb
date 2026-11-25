// Contrato de efeito do transmissor TISS (C2-070, 06-FAT linha 26) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA: estabelecimento com o código do teste e mensagens de saída com cargas só de ids fictícios.
// Prova o que fica no banco: só as mensagens 'enviada' sem resposta dos pontos da elegibilidade e da comunicação de
// beneficiário são transmitidas; o destino falso grava o recibo e a mensagem fica 'processada' com processada_em e a
// versão somada; o recibo gravado é lido pela regra do domínio como a resposta (elegível com código de validação;
// comunicação confirmada com protocolo); a falha de transporte fica 'erro' com o código, sem resposta; outro ponto, a
// pendente e a já respondida não mudam; a segunda volta não responde de novo. Fora de produção o destino é sempre o
// falso; em produção sem transporte, nenhum.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { respostaElegibilidadeDoRetorno } from '@sgh/dominio-faturamento';
import { retornoDaIntegracao } from '@sgh/dominio-internacao';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  escrever,
  garantirCliente,
  garantirEstabelecimento,
  SEM_BANCO,
} from './importadores/integracao.spec-util.js';
import {
  cicloTransmissorTiss,
  destinoDoAmbiente,
  destinoFalsoTiss,
  type DestinoTiss,
} from './transmissor-tiss.service.js';

describe.skipIf(SEM_BANCO)('transmissor TISS pelo serviço web (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  const id: Record<string, number> = {};
  const linha = (m: number) =>
    escrever(nucleo, (e) =>
      e.uma<Record<string, unknown>>(
        'SELECT situacao, resposta, erro, processada_em, versao FROM integracao_mensagem WHERE id = ?',
        [m],
      ),
    );

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, async (e) => {
      est = await garantirEstabelecimento(e, 'c2070tx');
      await e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [est]);
      const msg = (ponto: string, situacao: string, resposta: string | null, carga: object) =>
        e.inserir(
          `INSERT INTO integracao_mensagem (estabelecimento_id, ponto, direcao, situacao, conteudo, resposta, criado_em,
             versao) VALUES (?, ?, 'saida', ?, ?, ?, ?, 1)`,
          [est, ponto, situacao, JSON.stringify(carga), resposta, new Date()],
        );
      id['elegibilidade'] = await msg('tiss.elegibilidade', 'enviada', null, { consulta: 1, fonte: 2 });
      id['comunicacao'] = await msg('tiss.comunicacao_beneficiario', 'enviada', null, { comunicacao: 3 });
      id['falha'] = await msg('tiss.elegibilidade', 'enviada', null, { consulta: 4, falhar: true });
      id['outroPonto'] = await msg('teste.sintetico', 'enviada', null, { item: 5 });
      id['pendente'] = await msg('tiss.elegibilidade', 'pendente', null, { consulta: 6 });
      id['respondida'] = await msg('tiss.elegibilidade', 'enviada', '{"elegivel":false}', { consulta: 7 });
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await escrever(nucleo, (e) =>
      e.executar('DELETE FROM integracao_mensagem WHERE estabelecimento_id = ?', [est]),
    );
    await nucleo.encerrar();
  });

  it('o destino falso responde as enviadas dos pontos TISS; o recibo vira a resposta pela regra do domínio', async () => {
    const vistos: string[] = [];
    const destino: DestinoTiss = (m) => {
      vistos.push(`${m.ponto}:${m.id}`);
      if (m.carga['falhar'] === true) return Promise.reject(new TypeError('sem rota (simulado)'));
      return destinoFalsoTiss(m);
    };
    const r = await cicloTransmissorTiss(nucleo, CLIENTE, destino, { estabelecimento: est });
    expect(r).toEqual({ lidas: 3, processadas: 2, falhas: 1 });
    expect(vistos).toEqual([
      `tiss.elegibilidade:${id['elegibilidade']}`,
      `tiss.comunicacao_beneficiario:${id['comunicacao']}`,
      `tiss.elegibilidade:${id['falha']}`,
    ]);

    const ele = await linha(id['elegibilidade']!);
    expect(ele).toMatchObject({ situacao: 'processada', erro: null, versao: 2 });
    expect(ele?.['processada_em']).toBeInstanceOf(Date);
    expect(
      respostaElegibilidadeDoRetorno({
        situacaoMensagem: 'processada',
        resposta: String(ele?.['resposta']),
        erro: null,
      }),
    ).toEqual({
      situacao: 'elegivel',
      motivoNegativa: null,
      motivoGlosa: null,
      codigoValidacao: `FALSO${id['elegibilidade']}`,
    });

    const com = await linha(id['comunicacao']!);
    expect(com).toMatchObject({ situacao: 'processada', versao: 2 });
    expect(
      retornoDaIntegracao({
        situacaoComunicacao: 'enviada',
        situacaoMensagem: 'processada',
        resposta: String(com?.['resposta']),
        erro: null,
      }).retorno,
    ).toEqual({ acao: 'confirmar', protocolo: `FALSO${id['comunicacao']}`, resposta: null });

    const falha = await linha(id['falha']!);
    expect(falha).toMatchObject({
      situacao: 'erro',
      resposta: null,
      erro: 'transporte-falhou:TypeError',
      versao: 2,
    });
    expect(
      respostaElegibilidadeDoRetorno({
        situacaoMensagem: 'erro',
        resposta: null,
        erro: String(falha?.['erro']),
      })?.situacao,
    ).toBe('erro');

    // Outro ponto, a pendente (o relay ainda não tirou da outbox) e a já respondida ficam como estavam.
    expect(await linha(id['outroPonto']!)).toMatchObject({ situacao: 'enviada', resposta: null, versao: 1 });
    expect(await linha(id['pendente']!)).toMatchObject({ situacao: 'pendente', resposta: null, versao: 1 });
    expect(await linha(id['respondida']!)).toMatchObject({ situacao: 'enviada', versao: 1 });

    // A segunda volta não responde de novo.
    expect(await cicloTransmissorTiss(nucleo, CLIENTE, destino, { estabelecimento: est })).toEqual({
      lidas: 0,
      processadas: 0,
      falhas: 0,
    });
    expect(await linha(id['elegibilidade']!)).toMatchObject({ versao: 2 });
  });

  it('fora de produção o destino é o falso; em produção só o transporte configurado', () => {
    expect(destinoDoAmbiente({ AMBIENTE: 'dev' })).toBe(destinoFalsoTiss);
    expect(destinoDoAmbiente({})).toBe(destinoFalsoTiss);
    expect(destinoDoAmbiente({ AMBIENTE: 'producao' })).toBeNull();
    const real: DestinoTiss = () => Promise.resolve({ aceita: true, protocolo: 'P' });
    expect(destinoDoAmbiente({ AMBIENTE: 'producao' }, real)).toBe(real);
  });
});
