// W0-09 sobre a cópia (transação desfeita): o ciclo de vida do comunicado nas tabelas SGH_ (1120): a correção do texto
// ainda não lido (o anterior no SGH_ADM_MENSAGEM_EVENTO), a recusa 409 depois da leitura, a vigência que só encurta e o
// encerramento com motivo que mantém o comunicado e a ciência visíveis. A SGH_TRILHA leva o evento, nunca o texto. Só
// contagens e códigos na saída.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { portaComunicacaoNaTransacao } from '../comunicacao-porta.js';
import { ServicoComunicacao } from './comunicacao.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER, usuariosAtivos } from './copia.spec-util.js';

const TEXTO_NOVO = 'Texto corrigido sintetico do W0-09 que nao vai a trilha';

describe.skipIf(!PODE_ESCREVER)('comunicado: ciclo de vida na cópia (W0-09; transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('corrige o não lido, recusa o lido (409), encurta a vigência e encerra mantendo a ciência visível', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w009-comunicado' }, async (e) => {
      const u = await usuariosAtivos(e);
      const porta = portaComunicacaoNaTransacao(e, a.executor);
      const s = new ServicoComunicacao(porta, null);
      const gestor = { login: u.a, estacao: 'INT-W009', correlacao: 'int-w009-comunicado-1' };
      const dest = { login: u.b, estacao: 'INT-W009', correlacao: 'int-w009-comunicado-2' };
      const publicar = (chave: string) =>
        s.publicar(
          a.c,
          gestor,
          {
            assunto: 'Comunicado W0-09',
            texto: 'Texto original sintetico.',
            destinos: [{ tipo: 'usuario', valor: u.b }],
            cienciaObrigatoria: true,
            vigenciaInicio: '2026-01-01T00:00',
            vigenciaFim: '2099-12-31T23:59',
          },
          chave,
        );
      const { id } = await publicar('int-w009-com-0001');

      // Correção do texto não lido: o anterior vai ao evento; o texto novo não vai à trilha.
      const c1 = await s.corrigirComunicado(a.c, gestor, id, {
        assunto: 'Comunicado W0-09 (corrigido)',
        texto: TEXTO_NOVO,
        motivo: 'Data errada',
      });
      expect(c1.texto).toBe(TEXTO_NOVO);
      expect(c1.eventos.map((x) => x.evento)).toEqual(['correcao']);
      expect(JSON.parse(c1.eventos[0]?.antes ?? '{}')).toMatchObject({ texto: 'Texto original sintetico.' });

      // Vigência: estender e o passado são recusados; encurtar guarda o fim anterior.
      await expect(
        s.encurtarVigencia(a.c, gestor, id, { vigenciaFim: '2100-01-01T00:00', motivo: 'Estender' }),
      ).rejects.toMatchObject({ problema: { status: 409, codigo: 'vigencia-invalida' } });
      await expect(
        s.encurtarVigencia(a.c, gestor, id, { vigenciaFim: '2026-01-02T00:00', motivo: 'Passado' }),
      ).rejects.toMatchObject({ problema: { status: 409, codigo: 'vigencia-invalida' } });
      const c2 = await s.encurtarVigencia(a.c, gestor, id, {
        vigenciaFim: '2098-06-30T18:00',
        motivo: 'Encurtar',
      });
      expect(c2.vigenciaFim.slice(0, 16)).toBe('2098-06-30T18:00');
      expect(c2.eventos.at(-1)).toMatchObject({ evento: 'vigencia', antes: '2099-12-31T23:59:00' });

      // Lido e com ciência: o texto não se edita mais (409, com a contagem).
      await s.abrir(a.c, dest, id);
      await s.ciencia(a.c, dest, id);
      await expect(
        s.corrigirComunicado(a.c, gestor, id, { assunto: 'x', texto: 'y', motivo: 'Tentar corrigir' }),
      ).rejects.toMatchObject({ problema: { status: 409, codigo: 'comunicado-ja-lido' } });

      // Encerramento: com motivo; o comunicado e a ciência continuam visíveis; nada mais muda.
      const c3 = await s.encerrarComunicado(a.c, gestor, id, { motivo: 'Substituido por outro' });
      expect(c3.encerradoEm).not.toBeNull();
      expect(c3.motivoEncerramento).toBe('Substituido por outro');
      expect(c3.destinatarios[0]?.cienciaEm).not.toBeNull();
      expect(c3.podeCorrigir).toBe(false);
      await expect(s.encerrarComunicado(a.c, gestor, id, { motivo: 'De novo' })).rejects.toMatchObject({
        problema: { status: 409, codigo: 'comunicado-encerrado' },
      });
      const caixa = await s.caixa(a.c, u.b);
      expect(caixa.recebidas.find((x) => x.id === id)?.motivoEncerramento).toBe('Substituido por outro');

      // O encerrado e não lido some da caixa e não pede ciência.
      const { id: id2 } = await publicar('int-w009-com-0002');
      await s.encerrarComunicado(a.c, gestor, id2, { motivo: 'Publicado por engano' });
      expect((await s.caixa(a.c, u.b)).recebidas.some((x) => x.id === id2)).toBe(false);

      const ev = await e.consultar(
        'SELECT EVENTO FROM SGH_ADM_MENSAGEM_EVENTO WHERE ID_MENSAGEM = CAST(CAST(? AS VARCHAR(20)) AS BIGINT) ORDER BY ID',
        [String(id)],
        { teto: 10 },
      );
      expect(ev.map((x) => String(x['EVENTO']).trim())).toEqual(['correcao', 'vigencia', 'encerramento']);
      const trilha = await e.consultar(
        "SELECT * FROM SGH_TRILHA WHERE HOSPITAL = ? AND CORRELACAO STARTING WITH 'int-w009-comunicado'",
        [a.c.hospital],
        { teto: 50 },
      );
      const eventos = trilha.map((t) => String(t['EVENTO']).trim());
      for (const x of [
        'acesso.comunicado.corrigido',
        'acesso.comunicado.vigenciaEncurtada',
        'acesso.comunicado.encerrado',
      ])
        expect(eventos).toContain(x);
      expect(JSON.stringify(trilha)).not.toContain(TEXTO_NOVO);
    });
  });

  it('revisão: o texto de 2000 caracteres com quebras de linha e aspas, corrigido, fica inteiro no evento (1128)', async () => {
    await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-w009-comunicado-longo' }, async (e) => {
      const u = await usuariosAtivos(e);
      const s = new ServicoComunicacao(portaComunicacaoNaTransacao(e, a.executor), null);
      const gestor = { login: u.a, estacao: 'INT-W009', correlacao: 'int-w009-comunicado-longo' };
      const assunto = `${'Assunto longo '.repeat(8)}"x"`.slice(0, 120);
      const texto = Array.from({ length: 400 }, () => 'li"a\n').join('');
      const { id } = await s.publicar(
        a.c,
        gestor,
        {
          assunto,
          texto,
          destinos: [{ tipo: 'usuario', valor: u.b }],
          cienciaObrigatoria: false,
          vigenciaInicio: '2026-01-01T00:00',
          vigenciaFim: '2099-12-31T23:59',
        },
        'int-w009-com-longo',
      );
      const c = await s.corrigirComunicado(a.c, gestor, id, {
        assunto: 'Curto',
        texto: 'Texto curto.',
        motivo: 'Texto longo demais',
      });
      const antes = c.eventos[0]?.antes ?? '';
      expect(antes.length).toBeGreaterThan(2200);
      expect(JSON.parse(antes)).toEqual({ assunto, texto });
    });
  });
});
