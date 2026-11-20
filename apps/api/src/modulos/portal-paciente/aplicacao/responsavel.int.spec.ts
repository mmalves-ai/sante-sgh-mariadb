// Regra 5 do M50 (responsável legal com prova; LGPD art. 14) na cópia, em transação SEMPRE desfeita: o serviço do portal
// sobre a porta do legado (SGH_POR_CONTA, SGH_POR_RESPONSAVEL) com os pacientes SINTÉTICOS sobrepostos:
//   - a mãe (conta ativada por convite com o segundo fator) pede o acesso do filho menor com a prova; o pedido para um
//     maior com vínculo de menor é recusado;
//   - outra pessoa aprova; quem pediu não aprova (regra pura e CHECK do banco);
//   - na maioridade, a sessão deixa de mostrar o filho e o job encerra o vínculo com o motivo;
//   - o procurador vence com a procuração; o titular revoga o procurador;
//   - só tabelas SGH_ escritas na transação; nada fica depois do ROLLBACK.
import { codigoTotp } from '@sgh/dominio-acesso';
import { escritasDaTransacao, vinculosDoTitularPortal } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { ServicoPortalPaciente } from './servico.js';
import { FILHO, MAE, OUTRO, quem, servicoNaCopia } from './copia.spec-util.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(60, 3)]);

async function ativar(
  s: ServicoPortalPaciente,
  q: ReturnType<typeof quem>,
  paciente: number,
  nascimento: string,
  email: string,
  agora: () => Date,
) {
  const c = await s.convidar(q, { idPaciente: paciente, origem: 'recepcao' });
  const a = await s.conferirConvite(
    q.hospital,
    { codigo: c.codigo, nascimento },
    `10.77.0.${paciente % 200}`,
  );
  const csrf = { cookie: a.csrf, cabecalho: a.csrf };
  const ini = await s.iniciarAtivacao(a.id, csrf, {
    codigo: c.codigo,
    nascimento,
    email,
    senha: 'frase-sintetica-longa',
    confirmacao: 'frase-sintetica-longa',
    termoUso: '2026.1',
    politicaPrivacidade: '2026.1',
  });
  const segredo = new URL(ini.otpauth).searchParams.get('secret') ?? '';
  const r = await s.confirmarSegundoFator(a.id, csrf, { codigo: codigoTotp(segredo, agora().getTime()) });
  return { sessao: r.id, segredo };
}

describe.skipIf(!PODE_ESCREVER)('responsável legal na cópia (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('pai/mãe de menor com prova; recusa para maior; outra pessoa aprova; quem pediu não aprova; maioridade; procurador vence; titular revoga', async () => {
    const relogio = { agora: new Date('2034-04-01T12:00:00.000Z') };
    const agora = () => relogio.agora;
    const q = quem(a.c.rede, a.cod, 'SGH.TESTE.M501');
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m501-resp' }, async (e) => {
      const s = servicoNaCopia(e, a.c.rede, relogio);
      const mae = await ativar(s, q, MAE, '1990-07-01', `mae-${a.cod}@portal.test`, agora);
      const n = await s.sessao(mae.sessao);
      const { arquivo } = await s.enviarProva(n, 'image/png', PNG);
      // Recusa: vínculo de pai/mãe para um maior (a recusa consome o arquivo: o pedido certo vai com outro envio).
      await expect(
        s.pedirVinculo(
          n,
          {
            prontuario: 950_003,
            nascimento: '1980-01-01',
            tipo: 'pai-mae',
            prova: 'certidao-nascimento',
            arquivo,
            validade: null,
          },
          '10.9.9.9',
        ),
      ).rejects.toMatchObject({ extras: { codigo: 'titular-maior' } });
      const v = await s.pedirVinculo(
        n,
        {
          prontuario: 950_002,
          nascimento: '2016-05-10',
          tipo: 'pai-mae',
          prova: 'certidao-nascimento',
          arquivo: (await s.enviarProva(n, 'image/png', PNG)).arquivo,
          validade: null,
        },
        '10.9.9.9',
      );
      expect(v).toMatchObject({ situacao: 'pendente', terminaEm: '2034-05-10' });
      // Quem pediu não aprova: a regra pura antes de gravar.
      await expect(
        s.decidir(quem(a.c.rede, a.cod, `SGH.PORTAL.C${(await s.sessao(mae.sessao)).conta.id}`), {
          decisao: 'aprovar',
          vinculo: v.vinculo,
          escopos: ['documentos'],
          validade: null,
        }),
      ).rejects.toMatchObject({ extras: { codigo: 'quem-pediu-nao-decide' } });
      const ok = await s.decidir(quem(a.c.rede, a.cod, 'SGH.TESTE.M501B'), {
        decisao: 'aprovar',
        vinculo: v.vinculo,
        escopos: ['documentos', 'consentimentos'],
        validade: null,
      });
      expect(ok).toMatchObject({ situacao: 'ativo', escopos: ['consentimentos', 'documentos'] });
      // A fila no banco (a página por ordem de chegada, o filtro pelo índice do titular): a busca pelo prontuário do
      // representado e os responsáveis vigentes na ficha do filho. A comparação do CPF do guardião com cadastros reais
      // é provada no @sgh/legado (aqui os pacientes são sintéticos).
      const busca = await s.fila(q, { situacao: 'ativo', prontuario: 950_002 });
      expect(busca.itens.map((x) => x.vinculo)).toEqual([v.vinculo]);
      expect(busca.itens[0]?.guardiao).toBe('nao-confere');
      expect(busca.proximo).toBeNull();
      expect((await s.responsaveisDoPaciente(q, FILHO)).map((x) => x.vinculo)).toEqual([v.vinculo]);
      expect((await s.sessao(mae.sessao)).titulares.map((t) => t.primeiroNome)).toEqual(['Mae', 'Filho']);
      // A cada salto do relógio a sessão vence por inatividade: entra de novo com e-mail, senha e código. O código vale
      // uma vez: cada entrada anda um passo do autenticador (30 s).
      let ip = 0;
      const entra = async (email: string, segredo: string) => {
        relogio.agora = new Date(relogio.agora.getTime() + 30_000);
        return s.sessao(
          (
            await s.entrar(
              a.cod,
              { email, senha: 'frase-sintetica-longa', codigo: codigoTotp(segredo, relogio.agora.getTime()) },
              `10.77.1.${++ip}`,
            )
          ).id,
        );
      };
      const emailMae = `mae-${a.cod}@portal.test`;
      const emailOutro = `outro-${a.cod}@portal.test`;
      // Maioridade (18 anos em 2034-05-10): a sessão deixa de mostrar o filho; o job encerra com o motivo.
      relogio.agora = new Date('2034-05-10T15:00:00.000Z');
      expect((await entra(emailMae, mae.segredo)).titulares).toHaveLength(1);
      expect(await s.varrerVigencias(a.cod)).toMatchObject({ vinculos: 1 });
      expect((await vinculosDoTitularPortal(e, a.cod, FILHO))[0]).toMatchObject({
        situacao: 'encerrado',
        motivoFim: 'maioridade',
      });
      // Procurador: o OUTRO (maior) dá procuração à mãe até 2034-06-30; vence com a procuração.
      const outro = await ativar(s, q, OUTRO, '1980-01-01', emailOutro, agora);
      const n2 = await entra(emailMae, mae.segredo);
      const p2 = await s.enviarProva(n2, 'image/png', PNG);
      const proc = await s.pedirVinculo(
        n2,
        {
          prontuario: 950_003,
          nascimento: '1980-01-01',
          tipo: 'procurador',
          prova: 'procuracao',
          arquivo: p2.arquivo,
          validade: '2034-06-30',
        },
        '10.9.9.9',
      );
      await s.decidir(quem(a.c.rede, a.cod, 'SGH.TESTE.M501B'), {
        decisao: 'aprovar',
        vinculo: proc.vinculo,
        escopos: ['documentos'],
        validade: null,
      });
      expect((await s.sessao(n2.s.id)).titulares).toHaveLength(2);
      expect((await s.vinculos(await s.sessao(outro.sessao))).deMim).toHaveLength(1);
      relogio.agora = new Date('2034-07-01T12:00:00.000Z');
      expect((await entra(emailMae, mae.segredo)).titulares).toHaveLength(1);
      expect(await s.varrerVigencias(a.cod)).toMatchObject({ vinculos: 1 });
      expect((await vinculosDoTitularPortal(e, a.cod, OUTRO))[0]).toMatchObject({
        situacao: 'encerrado',
        motivoFim: 'validade',
      });
      // O titular revoga um procurador novo (ainda pendente).
      const n3 = await entra(emailMae, mae.segredo);
      const p3 = await s.enviarProva(n3, 'image/png', PNG);
      const proc2 = await s.pedirVinculo(
        n3,
        {
          prontuario: 950_003,
          nascimento: '1980-01-01',
          tipo: 'procurador',
          prova: 'procuracao',
          arquivo: p3.arquivo,
          validade: '2034-12-31',
        },
        '10.9.9.9',
      );
      await s.revogarVinculo(await entra(emailOutro, outro.segredo), Number(proc2.vinculo));
      expect((await vinculosDoTitularPortal(e, a.cod, OUTRO))[0]).toMatchObject({
        situacao: 'encerrado',
        motivoFim: 'revogado-pelo-titular',
      });
      return (await escritasDaTransacao(e)).map((w) => w.tabela).sort();
    });
    for (const t of r) expect(t).toMatch(/^SGH_/);
    expect(r).toEqual(expect.arrayContaining(['SGH_POR_CONTA', 'SGH_POR_RESPONSAVEL', 'SGH_TRILHA']));
    const depois = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m501-resp' }, (l) =>
      vinculosDoTitularPortal(l, a.cod, FILHO),
    );
    expect(depois).toEqual([]);
  });
});
