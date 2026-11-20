// Regra 1 do M50 (o portal só expõe o que foi liberado) na cópia, em transação SEMPRE desfeita: o serviço do portal
// sobre a porta do legado com os pacientes SINTÉTICOS sobrepostos e documentos do novo SINTÉTICOS (SGH_PEP_DOCUMENTO):
//   - o documento só emitido (sem assinatura) e o de tipo que não vai ao portal (registro clínico) não aparecem; o
//     atestado assinado com ICP-Brasil aparece e abre (PORTAL_DOCUMENTO_VISTO na trilha, com o paciente);
//   - o documento de outro paciente não abre;
//   - o responsável sem o escopo dos documentos não vê os do representado;
//   - a sessão do portal exige o CSRF nas escritas; a conta bloqueada derruba a sessão;
//   - o relatório de acessos mostra a abertura pelo portal ("Você");
//   - só tabelas SGH_ escritas; ROLLBACK.
import { codigoTotp } from '@sgh/dominio-acesso';
import { escritasDaTransacao, gravarDocumentoSgh, gravarEventoAssinadoIcp } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import { FILHO, MAE, OUTRO, quem, servicoNaCopia } from './copia.spec-util.js';

describe.skipIf(!PODE_ESCREVER)('autorização do portal do paciente na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('só o assinado do próprio titular; outro paciente não; escopo do responsável; CSRF; bloqueio derruba; acessos', async () => {
    const relogio = { agora: new Date() };
    const q = quem(a.c.rede, a.cod, 'SGH.TESTE.M501');
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m501-aut' }, async (e) => {
      const s = servicoNaCopia(e, a.c.rede, relogio);
      const ctx = { hospital: a.cod, usuarioLegado: 'SGH.TESTE.M501' };
      const doc = (tipo: 'receita' | 'atestado' | 'registro-clinico', paciente: number, origemId: number) =>
        gravarDocumentoSgh(e, ctx, {
          tipo,
          origemTabela: 'PRATESTREQIMP',
          origemId,
          idAssinaturaDoc: null,
          paciente,
          atendimento: null,
          cbo: null,
          hashConteudo: String(origemId % 10).repeat(64),
        });
      const soEmitido = await doc('receita', MAE, 900_501_001);
      const assinado = await doc('atestado', MAE, 900_501_002);
      await gravarEventoAssinadoIcp(e, ctx, assinado);
      const clinico = await doc('registro-clinico', MAE, 900_501_003);
      await gravarEventoAssinadoIcp(e, ctx, clinico);
      const doOutro = await doc('atestado', OUTRO, 900_501_004);
      await gravarEventoAssinadoIcp(e, ctx, doOutro);
      const doFilho = await doc('atestado', FILHO, 900_501_005);
      await gravarEventoAssinadoIcp(e, ctx, doFilho);
      // A mãe ativa a conta (convite, nascimento, e-mail e senha, segundo fator).
      const c = await s.convidar(q, { idPaciente: MAE, origem: 'recepcao' });
      const at = await s.conferirConvite(a.cod, { codigo: c.codigo, nascimento: '1990-07-01' }, '10.78.0.1');
      const csrf = { cookie: at.csrf, cabecalho: at.csrf };
      const ini = await s.iniciarAtivacao(at.id, csrf, {
        codigo: c.codigo,
        nascimento: '1990-07-01',
        email: `mae-${a.cod}@portal.test`,
        senha: 'frase-sintetica-longa',
        confirmacao: 'frase-sintetica-longa',
        termoUso: '2026.1',
        politicaPrivacidade: '2026.1',
      });
      const segredo = new URL(ini.otpauth).searchParams.get('secret') ?? '';
      const sess = await s.confirmarSegundoFator(at.id, csrf, {
        codigo: codigoTotp(segredo, relogio.agora.getTime()),
      });
      // CSRF exigido nas escritas.
      await expect(s.sessao(sess.id, { cookie: sess.csrf, cabecalho: null })).rejects.toMatchObject({
        status: 403,
      });
      const n = await s.sessao(sess.id, { cookie: sess.csrf, cabecalho: sess.csrf });
      const lista = await s.documentos(n, 1);
      const ids = lista.itens.filter((i) => i.origem === 'documento').map((i) => Number(i.item));
      expect(ids).toContain(assinado);
      expect(ids).not.toContain(soEmitido);
      expect(ids).not.toContain(clinico);
      expect(ids).not.toContain(doOutro);
      const aberto = await s.abrirDocumento(
        n,
        { origem: 'documento', item: String(assinado), baixar: false },
        '10.78.0.2',
      );
      expect(aberto.item).toMatchObject({ titulo: 'atestado', assinatura: 'icp-brasil', visto: true });
      await expect(
        s.abrirDocumento(n, { origem: 'documento', item: String(doOutro), baixar: false }, '10.78.0.2'),
      ).rejects.toMatchObject({
        status: 404,
      });
      expect((await s.documentos(n, 1)).itens.find((i) => i.item === String(assinado))?.visto).toBe(true);
      // O relatório: a abertura pelo portal ("Você").
      const hoje = new Date(relogio.agora.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
      const ac = await s.acessos(n, { de: hoje, ate: hoje, pagina: 1 });
      expect(ac.itens).toEqual(
        expect.arrayContaining([expect.objectContaining({ natureza: 'portal', quem: 'Você', vezes: 1 })]),
      );
      // O responsável sem o escopo dos documentos (só consentimentos) não vê os do filho.
      const { arquivo } = await s.enviarProva(
        n,
        'image/png',
        Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(30)]),
      );
      const v = await s.pedirVinculo(
        n,
        {
          prontuario: 950_002,
          nascimento: '2016-05-10',
          tipo: 'pai-mae',
          prova: 'certidao-nascimento',
          arquivo,
          validade: null,
        },
        '10.9.9.9',
      );
      await s.decidir(quem(a.c.rede, a.cod, 'SGH.TESTE.M501B'), {
        decisao: 'aprovar',
        vinculo: v.vinculo,
        escopos: ['consentimentos'],
        validade: null,
      });
      await s.escolherTitular(await s.sessao(sess.id), v.vinculo);
      await expect(s.documentos(await s.sessao(sess.id), 1)).rejects.toMatchObject({ status: 403 });
      expect(await s.consentimentos(await s.sessao(sess.id))).toEqual([]);
      // O bloqueio pelo hospital derruba a sessão na hora.
      const conta = (await s.contaDoPaciente(q, MAE))!.conta;
      await s.bloquear(q, { conta, motivo: 'suspeita-de-fraude', justificativa: 'teste sintético na cópia' });
      await expect(s.sessao(sess.id)).rejects.toMatchObject({ status: 401 });
      return (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
    });
    for (const t of r) expect(t).toMatch(/^SGH_/);
    expect(r).toEqual(
      expect.arrayContaining(['SGH_PEP_DOCUMENTO', 'SGH_POR_CONTA', 'SGH_POR_RESPONSAVEL', 'SGH_TRILHA']),
    );
  });
});
