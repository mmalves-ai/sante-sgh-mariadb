<script setup lang="ts">
// Resultados críticos no portal do médico externo (W0-10, M5): `/medico-externo/criticos`, fora da casca interna. O
// servidor lista os avisos de valor crítico dos pacientes com vínculo assistencial do médico (o prazo e o escalonamento
// ao plantonista são os do hospital). A ciência pede a conduta e passa por um painel de confirmação; é registro novo no
// prontuário (não se apaga) e para o escalonamento. Já com ciência, o servidor devolve 409 com o texto mostrado aqui.
import type { AvisoCriticoPortalMedico } from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { cienciaCriticoPortal, criticosPortalMedico } from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const pronto = ref(false);
const lista = useQuery({
  queryKey: ['portal-medico', 'criticos'],
  queryFn: criticosPortalMedico,
  enabled: pronto,
});
const quando = (d: string | null) =>
  d ? `${d.slice(0, 10).split('-').reverse().join('/')} ${d.slice(11, 16)}`.trim() : '—';

const emCiencia = ref<AvisoCriticoPortalMedico | null>(null);
const conduta = ref('');
const revisando = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const feito = ref<string | null>(null);
const podeRevisar = computed(() => conduta.value.trim().length >= 5);

function abrir(a: AvisoCriticoPortalMedico): void {
  emCiencia.value = a;
  conduta.value = '';
  revisando.value = false;
  erro.value = null;
  feito.value = null;
}

function desistir(): void {
  emCiencia.value = null;
  revisando.value = false;
}

async function confirmar(): Promise<void> {
  const a = emCiencia.value;
  if (!a) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await cienciaCriticoPortal(a.aviso, conduta.value.trim());
    feito.value = r.mensagem ?? t('portalMedico.criticos.registrada');
    emCiencia.value = null;
    revisando.value = false;
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
    await cliente.invalidateQueries({ queryKey: ['portal-medico', 'criticos'] });
  }
}

function rotulo(a: AvisoCriticoPortalMedico): string {
  if (a.ciencia) return t('portalMedico.criticos.rotulo.comCiencia', { quando: quando(a.ciencia.em) });
  if (a.nivel > 0)
    return t('portalMedico.criticos.rotulo.escalonado', { nivel: a.nivelRotulo.toLowerCase() });
  return t('portalMedico.criticos.rotulo.aguardandoCiencia');
}
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.criticos.titulo')" @sessao="pronto = true">
    <template #default>
      <p class="secundario">{{ t('portalMedico.criticos.explicacao') }}</p>
      <p v-if="feito" role="status" data-testid="pm-ciencia-feita">{{ feito }}</p>
      <ErroPortalMedico v-if="erro" :erro="erro" />
      <ErroPortalMedico v-if="lista.error.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('portalMedico.carregando') }}</p>
      <p v-else-if="!lista.data.value.vinculado" role="note" data-testid="pm-sem-vinculo">
        {{ t('portalMedico.semVinculo') }}
      </p>
      <template v-else>
        <p v-if="lista.data.value.pendentes" role="note" data-testid="pm-criticos-pendentes">
          {{ t('portalMedico.criticos.pendentes', { n: lista.data.value.pendentes }) }}
        </p>
        <table v-if="lista.data.value.avisos.length" class="tabela" data-testid="pm-criticos">
          <thead>
            <tr>
              <th scope="col">{{ t('portalMedico.criticos.paciente') }}</th>
              <th scope="col">{{ t('portalMedico.criticos.resultado') }}</th>
              <th scope="col">{{ t('portalMedico.criticos.prazo') }}</th>
              <th scope="col">{{ t('portalMedico.criticos.situacao') }}</th>
              <th scope="col">{{ t('portalMedico.criticos.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in lista.data.value.avisos" :key="a.aviso" :data-testid="`pm-critico-${a.aviso}`">
              <td>
                <strong>{{ a.nome }}</strong>
                <span class="secundario">
                  · {{ t('portalMedico.criticos.prontuario', { numero: a.prontuario }) }}</span
                >
              </td>
              <td>
                <strong class="critico">{{ a.elemento }}: {{ a.valor }}</strong>
                <span class="secundario"> · {{ quando(a.liberadoEm) }}</span>
              </td>
              <td>{{ quando(a.prazoEm) }}</td>
              <td :data-testid="`pm-critico-situacao-${a.aviso}`">
                {{ rotulo(a) }}
                <span v-if="a.notificacao" class="secundario">
                  · {{ t('portalMedico.criticos.notificado', { quando: quando(a.notificacao.em) }) }}</span
                >
              </td>
              <td>
                <SanteBotao
                  v-if="!a.ciencia"
                  variante="secundario"
                  :rotulo="t('portalMedico.criticos.darCiencia')"
                  :desabilitado="ocupado"
                  :data-testid="`pm-ciencia-${a.aviso}`"
                  @acionar="abrir(a)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else data-testid="pm-criticos-vazia">{{ t('portalMedico.criticos.nenhum') }}</p>
      </template>

      <form v-if="emCiencia" class="painel" data-testid="pm-form-ciencia" @submit.prevent>
        <span class="campo">
          <label for="pm-conduta">{{ t('portalMedico.criticos.conduta') }}</label>
          <input
            id="pm-conduta"
            v-model="conduta"
            maxlength="500"
            aria-describedby="pm-conduta-ajuda"
            data-testid="pm-conduta"
          />
          <small id="pm-conduta-ajuda" class="secundario">{{
            t('portalMedico.criticos.condutaAjuda')
          }}</small>
        </span>
        <div v-if="revisando" class="painel" role="alertdialog" data-testid="pm-ciencia-confirmar">
          <h3>{{ t('portalMedico.criticos.confirmarTitulo') }}</h3>
          <p>
            {{
              t('portalMedico.criticos.confirmarTexto', {
                elemento: emCiencia.elemento,
                valor: emCiencia.valor,
                nome: emCiencia.nome,
                conduta: conduta.trim(),
              })
            }}
          </p>
          <p class="acoes">
            <SanteBotao
              :rotulo="t('portalMedico.criticos.confirmar')"
              :desabilitado="ocupado"
              data-testid="pm-ciencia-sim"
              @acionar="confirmar"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('portalMedico.criticos.voltar')"
              @acionar="revisando = false"
            />
          </p>
        </div>
        <p v-else class="acoes">
          <SanteBotao
            :rotulo="t('portalMedico.criticos.revisar')"
            :desabilitado="!podeRevisar"
            data-testid="pm-ciencia-revisar"
            @acionar="revisando = true"
          />
          <SanteBotao variante="texto" :rotulo="t('portalMedico.criticos.desistir')" @acionar="desistir" />
        </p>
      </form>
    </template>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.critico {
  color: var(--sgh-perigo);
}
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-1);
}
.painel {
  margin-top: var(--sgh-espaco-4);
}
</style>
