<script setup lang="ts">
// "Backup verificado" (M59-F5; ficha do M59, seção 7; SBIS-13): painel da restauração de teste diária (em dia até
// 26 h) e mensal (até 32 dias), com os alertas e as restaurações registradas. O operador de backup
// (auditoria.backup.registrar) registra o relatório de cada restauração: início, fim, resultado, integridade
// conferida, tamanho e ambiente; restauração sem a integridade conferida não conta. Ligada a partir de
// "Backup e restauração".
import {
  PERMISSOES_M59_F5_CODIGOS as P,
  INTEGRIDADES_RESTAURACAO,
  RESULTADOS_RESTAURACAO,
  TIPOS_RESTAURACAO,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import { buscarBackupVerificado, registrarRestauracao } from '../api-sbis.js';
import { dataHora, type FalhaRestauracao, montarRestauracao } from '../sbis-tela.js';

const { t } = useI18n();
const qc = useQueryClient();
const podeRegistrar = computed(() => pode(P.backupRegistrar));
const painel = useQuery({ queryKey: ['sbis', 'backup'], queryFn: () => buscarBackupVerificado() });

const vazio = () => ({
  tipo: 'diaria' as (typeof TIPOS_RESTAURACAO)[number],
  inicio: '',
  fim: '',
  resultado: 'ok' as (typeof RESULTADOS_RESTAURACAO)[number],
  integridade: 'ok' as (typeof INTEGRIDADES_RESTAURACAO)[number],
  tamanhoMb: '',
  ambiente: '',
  observacao: '',
});
const form = ref(vazio());
const falha = ref<FalhaRestauracao | null>(null);
const erro = ref<unknown>(null);
const aviso = ref('');
const ocupado = ref(false);

const opcoes = <T extends string>(lista: readonly T[], grupo: string) =>
  computed(() => lista.map((v) => ({ valor: v, rotulo: t(`sbis.backup.${grupo}.${v}`) })));
const opcoesTipo = opcoes(TIPOS_RESTAURACAO, 'tipos');
const opcoesResultado = opcoes(RESULTADOS_RESTAURACAO, 'resultados');
const opcoesIntegridade = opcoes(INTEGRIDADES_RESTAURACAO, 'integridades');

async function registrar(): Promise<void> {
  if (ocupado.value) return;
  aviso.value = '';
  erro.value = null;
  const m = montarRestauracao(form.value);
  if (!m.ok) {
    falha.value = m.falha;
    return;
  }
  falha.value = null;
  ocupado.value = true;
  try {
    await registrarRestauracao(m.pedido);
    aviso.value = t('sbis.backup.novo.registrado');
    form.value = vazio();
    await qc.invalidateQueries({ queryKey: ['sbis', 'backup'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="backup-verificado-titulo">
    <h1 id="backup-verificado-titulo">{{ t('sbis.backup.titulo') }}</h1>
    <p>{{ t('sbis.backup.texto') }}</p>
    <p>
      <RouterLink to="/administracao/backup" data-testid="backup-voltar">{{
        t('sbis.backup.voltar')
      }}</RouterLink>
    </p>
    <p v-if="!podeRegistrar" data-testid="backup-sem-registro">{{ t('sbis.backup.semRegistro') }}</p>
    <MensagemErro v-if="painel.isError.value" :erro="painel.error.value" />
    <p v-else-if="painel.isPending.value">{{ t('sbis.carregando') }}</p>
    <template v-else-if="painel.data.value">
      <p v-if="painel.data.value.destino === 'memoria'" role="status">{{ t('sbis.memoria') }}</p>
      <div class="cartoes">
        <div
          v-for="s in [painel.data.value.diaria, painel.data.value.mensal]"
          :key="s.tipo"
          class="cartao"
          :data-testid="`backup-situacao-${s.tipo}`"
        >
          <h2>{{ t(`sbis.backup.situacao.${s.tipo}`) }}</h2>
          <p>
            <strong>{{
              s.emDia ? t('sbis.backup.situacao.emDia') : t('sbis.backup.situacao.atrasada')
            }}</strong>
          </p>
          <p>
            {{
              s.ultimaComSucesso
                ? t('sbis.backup.situacao.ultima', { em: dataHora(s.ultimaComSucesso) })
                : t('sbis.backup.situacao.nunca')
            }}
          </p>
          <p v-if="s.falhasRecentes > 0">{{ t('sbis.backup.situacao.falhas', { n: s.falhasRecentes }) }}</p>
        </div>
      </div>
      <template v-if="painel.data.value.alertas.length > 0">
        <h2>{{ t('sbis.backup.alertas') }}</h2>
        <ul data-testid="backup-alertas">
          <li v-for="a in painel.data.value.alertas" :key="a">{{ a }}</li>
        </ul>
      </template>

      <div class="rolagem" tabindex="0" role="region" :aria-label="t('sbis.backup.legenda')">
        <table data-testid="backup-restauracoes">
          <caption>
            {{
              t('sbis.backup.legenda')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sbis.backup.inicio') }}</th>
              <th scope="col">{{ t('sbis.backup.tipo') }}</th>
              <th scope="col">{{ t('sbis.backup.duracao') }}</th>
              <th scope="col">{{ t('sbis.backup.resultado') }}</th>
              <th scope="col">{{ t('sbis.backup.integridade') }}</th>
              <th scope="col">{{ t('sbis.backup.tamanho') }}</th>
              <th scope="col">{{ t('sbis.backup.ambiente') }}</th>
              <th scope="col">{{ t('sbis.backup.registradoPor') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="painel.data.value.restauracoes.length === 0">
              <td colspan="8">{{ t('sbis.nenhum') }}</td>
            </tr>
            <tr
              v-for="r in painel.data.value.restauracoes"
              :key="r.id"
              :data-testid="`backup-restauracao-${r.id}`"
            >
              <th scope="row">{{ dataHora(r.inicio) }}</th>
              <td>{{ t(`sbis.backup.tipos.${r.tipo}`) }}</td>
              <td>{{ t('sbis.backup.minutos', { n: r.duracaoMinutos }) }}</td>
              <td>{{ t(`sbis.backup.resultados.${r.resultado}`) }}</td>
              <td>{{ t(`sbis.backup.integridades.${r.integridade}`) }}</td>
              <td>{{ r.tamanhoMb ?? '—' }}</td>
              <td>
                {{ r.ambiente }}<span v-if="r.observacao"> · {{ r.observacao }}</span>
              </td>
              <td>{{ r.registradoPor }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="backup-aviso" />
      <MensagemErro v-if="erro" :erro="erro" />

      <form
        v-if="podeRegistrar"
        class="formulario"
        data-testid="form-backup-registrar"
        @submit.prevent="registrar"
      >
        <h2>{{ t('sbis.backup.novo.titulo') }}</h2>
        <SanteSelecao
          id="backup-tipo"
          v-model="form.tipo"
          :rotulo="t('sbis.backup.tipo')"
          :opcoes="opcoesTipo"
          data-testid="backup-tipo"
        />
        <div class="campo">
          <label for="backup-inicio">{{ t('sbis.backup.inicio') }}</label>
          <input
            id="backup-inicio"
            v-model="form.inicio"
            type="datetime-local"
            required
            data-testid="backup-inicio"
          />
        </div>
        <div class="campo">
          <label for="backup-fim">{{ t('sbis.backup.fim') }}</label>
          <input id="backup-fim" v-model="form.fim" type="datetime-local" required data-testid="backup-fim" />
        </div>
        <SanteSelecao
          id="backup-resultado"
          v-model="form.resultado"
          :rotulo="t('sbis.backup.resultado')"
          :opcoes="opcoesResultado"
          data-testid="backup-resultado"
        />
        <SanteSelecao
          id="backup-integridade"
          v-model="form.integridade"
          :rotulo="t('sbis.backup.integridade')"
          :opcoes="opcoesIntegridade"
          data-testid="backup-integridade"
        />
        <div class="campo">
          <label for="backup-tamanho">{{ t('sbis.backup.tamanho') }}</label>
          <input
            id="backup-tamanho"
            v-model="form.tamanhoMb"
            inputmode="numeric"
            pattern="\d*"
            data-testid="backup-tamanho"
          />
        </div>
        <div class="campo">
          <label for="backup-ambiente">{{ t('sbis.backup.ambiente') }}</label>
          <input
            id="backup-ambiente"
            v-model="form.ambiente"
            maxlength="80"
            required
            aria-describedby="backup-ambiente-ajuda"
            data-testid="backup-ambiente"
          />
          <small id="backup-ambiente-ajuda">{{ t('sbis.backup.novo.ambienteAjuda') }}</small>
        </div>
        <div class="campo">
          <label for="backup-observacao">{{ t('sbis.backup.observacao') }}</label>
          <textarea
            id="backup-observacao"
            v-model="form.observacao"
            maxlength="500"
            rows="2"
            data-testid="backup-observacao"
          />
        </div>
        <SanteAlerta
          v-if="falha"
          :texto="t(`sbis.backup.falhas.${falha}`)"
          variante="aviso"
          anunciar
          data-testid="backup-falha"
        />
        <SanteBotao
          :rotulo="t('sbis.backup.novo.registrar')"
          tipo="submit"
          :desabilitado="ocupado"
          data-testid="backup-registrar"
        />
      </form>
    </template>
  </section>
</template>

<style scoped>
.cartoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-3);
  margin: var(--sgh-espaco-2) 0;
}
.cartao {
  border: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
  min-width: 16rem;
}
.cartao h2 {
  margin-top: 0;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
  margin: var(--sgh-espaco-3) 0;
}
.campo {
  display: grid;
  gap: var(--sgh-espaco-1);
}
.rolagem {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
caption {
  text-align: left;
  font-weight: 600;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
input,
textarea {
  font: inherit;
  padding: var(--sgh-espaco-1);
  border: 1px solid var(--sgh-borda-forte);
  background: var(--sgh-fundo);
  color: var(--sgh-texto);
}
small {
  color: var(--sgh-texto-secundario);
}
</style>
