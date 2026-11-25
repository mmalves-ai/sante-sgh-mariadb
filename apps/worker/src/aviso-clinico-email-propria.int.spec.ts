// Contrato de efeito do despacho por e-mail do aviso clínico (03-PEP L133) contra o MariaDB real (cliente de teste).
// Massa SINTÉTICA: um estabelecimento e três contas com o código do teste (endereços em exemplo.invalid; uma sem
// e-mail), um aviso com destinatários nos canais e-mail e central; removidos na limpeza. O envio é trocado por um
// registrador (nada sai da VM). Prova o que fica no banco:
//   - o destinatário de e-mail entregue fica 'enviado' com a hora; o que falhou na entrega e a conta sem e-mail ficam
//     'falha' com o motivo curto (sem endereço); o da central não é tocado;
//   - o e-mail leva só o número do aviso e a prioridade (nem título nem texto do aviso);
//   - um segundo ciclo não envia de novo; a trilha da marca.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAvisoClinicoEmailPropria } from './aviso-clinico-email-propria.js';
import { cicloAvisoClinicoEmail } from './aviso-clinico-email.service.js';
import type { AlvoEstabelecimento } from './servico-worker.js';
import type { MensagemEmail } from './smtp.js';
import { limparTrilhaDaMassa } from './teste/limpar-trilha.spec-util.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const P = 'c2050ave';
const EST = `(SELECT id FROM estabelecimento WHERE codigo = '${P}')`;
const TITULO = 'Título sintético do aviso c2050';
const TEXTO = 'Texto clínico sintético que não pode ir ao e-mail';

async function limpar(e: Escritor): Promise<void> {
  await e.executar(
    `DELETE d FROM aviso_clinico_destinatario d JOIN aviso_clinico a ON a.id = d.aviso_clinico_id
      WHERE a.estabelecimento_id IN ${EST}`,
  );
  await e.executar(`DELETE FROM aviso_clinico WHERE estabelecimento_id IN ${EST}`);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar("DELETE FROM usuario WHERE login LIKE 'c2050ave.%'");
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)(
  'despacho por e-mail do aviso clínico contra o MariaDB (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let est: AlvoEstabelecimento;
    let d: { ok: number; semEmail: number; falha: number; central: number };
    const ler = (sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      const r = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const id = await e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
          [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
        );
        const conta = (login: string, email: string | null) =>
          e.inserir(
            `INSERT INTO usuario (login, nome, email, tipo_conta, situacao, criado_em)
           VALUES (?, 'Conta sintética c2050', ?, 'servico', 'ativo', ?)`,
            [login, email, agora],
          );
        const u1 = await conta('c2050ave.u1', 'c2050-ok@exemplo.invalid');
        const u2 = await conta('c2050ave.u2', null);
        const u3 = await conta('c2050ave.u3', 'c2050-falha@exemplo.invalid');
        const aviso = await e.inserir(
          `INSERT INTO aviso_clinico (estabelecimento_id, titulo, mensagem, prioridade, canal, situacao, gerado_em,
                                    modulo_origem, criado_em)
         VALUES (?, ?, ?, 'critica', 'email', 'pendente', ?, 'pep.aviso_clinico', ?)`,
          [id, TITULO, TEXTO, agora, agora],
        );
        const dest = (seq: number, usuario: number, canal: string) =>
          e.inserir(
            `INSERT INTO aviso_clinico_destinatario (aviso_clinico_id, sequencia, usuario_id, canal, situacao, criado_em)
           VALUES (?, ?, ?, ?, 'pendente', ?)`,
            [aviso, seq, usuario, canal, agora],
          );
        return {
          id,
          aviso,
          d: {
            ok: await dest(1, u1, 'email'),
            semEmail: await dest(2, u2, 'email'),
            falha: await dest(3, u3, 'email'),
            central: await dest(4, u1, 'sistema'),
          },
        };
      });
      est = { cliente: CLIENTE, id: r.id, codigo: P, fuso: 'America/Sao_Paulo' };
      d = r.d;
    });

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    });

    it('marca enviado, falha na entrega e conta sem e-mail; o da central fica intacto; não reenvia', async () => {
      const porta = new PortaAvisoClinicoEmailPropria(nucleo, CLIENTE);
      const enviados: MensagemEmail[] = [];
      const enviar = async (m: MensagemEmail) => {
        if (m.para.startsWith('c2050-falha')) throw new Error('recusado pelo servidor');
        enviados.push(m);
      };
      expect(await cicloAvisoClinicoEmail(porta, est, enviar, 'nao-responda@teste.invalid')).toEqual({
        enviados: 1,
        falhas: 2,
      });
      expect(enviados).toHaveLength(1);
      expect(enviados[0]!.assunto).toContain('crítica');
      expect(`${enviados[0]!.assunto}\n${enviados[0]!.texto}`).not.toContain(TITULO);
      expect(enviados[0]!.texto).not.toContain(TEXTO);

      const linhas = await ler(
        'SELECT id, situacao, enviado_em, erro_envio FROM aviso_clinico_destinatario WHERE id IN (?, ?, ?, ?)',
        [d.ok, d.semEmail, d.falha, d.central],
      );
      const por = new Map(linhas.map((x) => [Number(x['id']), x]));
      expect(por.get(d.ok)).toMatchObject({ situacao: 'enviado', erro_envio: null });
      expect(por.get(d.ok)!['enviado_em']).not.toBeNull();
      expect(por.get(d.semEmail)).toMatchObject({
        situacao: 'falha',
        erro_envio: 'Conta sem e-mail cadastrado.',
      });
      expect(por.get(d.falha)).toMatchObject({
        situacao: 'falha',
        erro_envio: 'Falha na entrega SMTP (Error).',
      });
      expect(String(por.get(d.falha)!['erro_envio'])).not.toContain('@');
      expect(por.get(d.central)).toMatchObject({ situacao: 'pendente', enviado_em: null });

      // Segundo ciclo: nada pendente no canal e-mail, nada enviado.
      expect(await cicloAvisoClinicoEmail(porta, est, enviar, 'nao-responda@teste.invalid')).toEqual({
        enviados: 0,
        falhas: 0,
      });
      expect(enviados).toHaveLength(1);
      const [t] = await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [
        est.id,
      ]);
      expect(Number(t!['n'])).toBe(3);
    });
  },
);
