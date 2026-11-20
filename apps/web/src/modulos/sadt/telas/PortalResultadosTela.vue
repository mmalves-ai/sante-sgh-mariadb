<script setup lang="ts">
// Portal de resultados (ficha do M26, seção 7; regra 9): `/resultados`. Fora da casca e da sessão interna: o paciente
// entra com o código do protocolo e a data de nascimento; o médico solicitante, com o conselho, a UF, o número, a senha e
// o código do aplicativo autenticador. Aparecem só os laudos liberados de setores publicados; abrir um laudo grava a
// visualização (data e IP). Nenhum resultado não liberado, evolução ou prescrição aparece aqui.
import type { LaudoPortalAberto, SessaoPortal } from '@sgh/contratos';
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import {
  abrirLaudoPortal,
  entrarMedico,
  entrarPaciente,
  estabelecimentoPadrao,
  euPortal,
  laudosPortal,
  sairPortal,
} from '../api-portal.js';
import ErroSadt from '../componentes/ErroSadt.vue';
import { quando } from '../usar-sadt.js';

const { t } = useI18n();
const rota = useRoute();
const hospital = ref(
  typeof rota.params['estabelecimento'] === 'string' ? rota.params['estabelecimento'] : '',
);
const perfil = ref<'paciente' | 'medicoExterno'>('paciente');
const sessao = ref<SessaoPortal | null>(null);
const protocolo = ref('');
const nascimento = ref('');
const uf = ref('');
const numero = ref('');
const senha = ref('');
const codigo = ref('');
const erro = ref<unknown>(null);
const ocupado = ref(false);
const aberto = ref<LaudoPortalAberto | null>(null);
onMounted(async () => {
  if (!hospital.value)
    hospital.value =
      (await estabelecimentoPadrao().catch(() => ({ estabelecimento: null }))).estabelecimento ?? '';
  sessao.value = await euPortal().catch(() => null);
});
const laudos = useQuery({
  queryKey: computed(() => ['portal', 'laudos', sessao.value?.perfil ?? '']),
  queryFn: () => laudosPortal(),
  enabled: computed(() => sessao.value !== null),
});
const perfis = computed(() => [
  { valor: 'paciente' as const, rotulo: t('sadt.portal.paciente') },
  { valor: 'medicoExterno' as const, rotulo: t('sadt.portal.medico') },
]);
async function entrar(): Promise<void> {
  erro.value = null;
  ocupado.value = true;
  try {
    sessao.value =
      perfil.value === 'paciente'
        ? await entrarPaciente(hospital.value, {
            protocolo: protocolo.value.trim(),
            nascimento: nascimento.value,
          })
        : await entrarMedico(hospital.value, {
            conselho: 'CRM',
            uf: uf.value.toUpperCase(),
            numero: numero.value,
            senha: senha.value,
            codigo: codigo.value,
          });
    senha.value = '';
    codigo.value = '';
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}
async function abrir(liberacao: number): Promise<void> {
  erro.value = null;
  try {
    aberto.value = await abrirLaudoPortal(liberacao);
    await laudos.refetch();
  } catch (x) {
    erro.value = x;
  }
}
async function sair(): Promise<void> {
  await sairPortal().catch(() => undefined);
  sessao.value = null;
  aberto.value = null;
}
</script>

<template>
  <main class="tela-agenda portal" aria-labelledby="portal-titulo" data-testid="tela-portal">
    <h1 id="portal-titulo">{{ t('sadt.portal.titulo') }}</h1>
    <template v-if="!sessao">
      <p>{{ t('sadt.portal.texto') }}</p>
      <form class="painel" @submit.prevent="entrar">
        <SanteSelecao
          v-model="perfil"
          :rotulo="t('sadt.portal.paciente')"
          :ocultar-rotulo="true"
          :opcoes="perfis"
          data-testid="portal-perfil"
        />
        <template v-if="perfil === 'paciente'">
          <span class="campo">
            <label for="portal-protocolo">{{ t('sadt.portal.protocolo') }}</label>
            <input
              id="portal-protocolo"
              v-model="protocolo"
              autocomplete="off"
              data-testid="portal-protocolo"
            />
          </span>
          <span class="campo">
            <label for="portal-nascimento">{{ t('sadt.portal.nascimento') }}</label>
            <input id="portal-nascimento" v-model="nascimento" type="date" data-testid="portal-nascimento" />
          </span>
        </template>
        <template v-else>
          <span class="campo">
            <label for="portal-uf">{{ t('sadt.portal.uf') }}</label>
            <input id="portal-uf" v-model="uf" maxlength="2" data-testid="portal-uf" />
          </span>
          <span class="campo">
            <label for="portal-numero">{{ t('sadt.portal.numero') }}</label>
            <input id="portal-numero" v-model="numero" inputmode="numeric" data-testid="portal-numero" />
          </span>
          <span class="campo">
            <label for="portal-senha">{{ t('sadt.portal.senha') }}</label>
            <input
              id="portal-senha"
              v-model="senha"
              type="password"
              autocomplete="current-password"
              data-testid="portal-senha"
            />
          </span>
          <span class="campo">
            <label for="portal-codigo">{{ t('sadt.portal.codigo') }}</label>
            <input
              id="portal-codigo"
              v-model="codigo"
              inputmode="numeric"
              autocomplete="one-time-code"
              data-testid="portal-codigo"
            />
          </span>
          <RouterLink :to="`/medico/cadastro${hospital ? `?estabelecimento=${hospital}` : ''}`">{{
            t('sadt.portal.cadastro')
          }}</RouterLink>
        </template>
        <SanteBotao
          tipo="submit"
          :rotulo="t('sadt.portal.entrar')"
          :desabilitado="ocupado"
          data-testid="portal-entrar"
          @acionar="entrar"
        />
      </form>
    </template>
    <template v-else>
      <p data-testid="portal-sessao">
        {{ t('sadt.portal.ola', { nome: sessao.nome }) }} ·
        {{ t('sadt.portal.expira', { hora: quando(sessao.expiraEm.slice(0, 19)).slice(-5) }) }}
      </p>
      <SanteBotao
        variante="secundario"
        :rotulo="t('sadt.portal.sair')"
        data-testid="portal-sair"
        @acionar="sair"
      />
      <nav v-if="sessao.perfil === 'medicoExterno'" class="acoes" :aria-label="t('portalMedico.titulo')">
        <RouterLink :to="{ name: 'portal.medico.extrato' }" data-testid="portal-medico-extrato">{{
          t('portalMedico.menu.extrato')
        }}</RouterLink>
        <RouterLink :to="{ name: 'portal.medico.agenda' }" data-testid="portal-medico-agenda">{{
          t('portalMedico.menu.agenda')
        }}</RouterLink>
      </nav>
      <p v-if="!laudos.data.value" role="status">{{ t('sadt.carregando') }}</p>
      <p v-else-if="laudos.data.value.laudos.length === 0">{{ t('sadt.portal.vazio') }}</p>
      <table v-else class="tabela" data-testid="portal-laudos">
        <caption>
          {{
            t('sadt.portal.laudos')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('sadt.exame') }}</th>
            <th scope="col">{{ t('sadt.setor') }}</th>
            <th scope="col">{{ t('sadt.data') }}</th>
            <th v-if="sessao.perfil === 'medicoExterno'" scope="col">{{ t('sadt.paciente') }}</th>
            <th scope="col">{{ t('sadt.acoes') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in laudos.data.value.laudos" :key="l.liberacao">
            <td>{{ l.nome }}</td>
            <td>{{ l.setor }}</td>
            <td>{{ l.data.split('-').reverse().join('/') }}</td>
            <td v-if="sessao.perfil === 'medicoExterno'">{{ l.paciente }}</td>
            <td>
              <SanteBotao
                variante="texto"
                :rotulo="t('sadt.portal.abrir')"
                :data-testid="`portal-abrir-${l.liberacao}`"
                @acionar="abrir(l.liberacao)"
              />
              <span v-if="l.visualizado" class="secundario"> · {{ t('sadt.portal.visto') }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <section v-if="aberto" class="painel" aria-labelledby="portal-laudo" data-testid="portal-laudo">
        <h2 id="portal-laudo">{{ aberto.laudo.nome }}</h2>
        <table v-if="aberto.valores.length" class="tabela">
          <caption>
            {{
              aberto.laudo.setor
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('sadt.digitacao.elemento') }}</th>
              <th scope="col">{{ t('sadt.valor') }}</th>
              <th scope="col">{{ t('sadt.referencia') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in aberto.valores" :key="v.elemento">
              <td>{{ v.elemento }}</td>
              <td>{{ v.valor }} {{ v.unidade ?? '' }}</td>
              <td>{{ v.referencia ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-for="(x, i) in aberto.texto" :key="i" class="laudo-texto">{{ x }}</p>
        <!-- M47 (etapa 3): o link das imagens do exame (estudo concluído no PACS). -->
        <p v-if="aberto.imagem" data-testid="portal-imagem">
          <a :href="aberto.imagem.link" target="_blank" rel="noopener noreferrer">{{
            t('pacs.portal.imagens', { visualizador: aberto.imagem.visualizador })
          }}</a>
        </p>
      </section>
    </template>
    <ErroSadt v-if="erro" :erro="erro" />
  </main>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.portal {
  margin: var(--sgh-espaco-4) auto;
  padding: var(--sgh-espaco-3);
  max-width: 60rem;
}
.laudo-texto {
  white-space: pre-wrap;
}
</style>
