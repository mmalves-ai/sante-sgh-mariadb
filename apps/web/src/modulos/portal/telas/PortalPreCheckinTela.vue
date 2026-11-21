<script setup lang="ts">
// Portal do paciente: pré-check-in (M50, etapa 2; ficha, seção 7 e regra 4). O paciente confere o contato e o endereço
// do cadastro e propõe a correção, envia a foto do documento, da carteirinha e do pedido médico (a foto é reduzida no
// navegador), informa a carteirinha e aceita o termo. Nada muda no cadastro até a recepção conferir; a recusa volta com
// o motivo e o paciente reenvia.
import {
  CAMPOS_PRECHECKIN,
  type CampoPreCheckin,
  type PreCheckinDoPortal,
  type TipoDocumentoPreCheckin,
  TIPOS_DOCUMENTO_PRECHECKIN,
  VERSAO_TERMO_PRECHECKIN,
  lerHoraDigitada,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto } from '@sgh/ui';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import ErroPortal from '../componentes/ErroPortal.vue';
import PortalCasca from '../componentes/PortalCasca.vue';
import { arquivoParaEnvio } from '../api-portal-paciente.js';
import { enviarArquivoPreCheckin, enviarPreCheckinPortal, preCheckinPortal } from '../api-portal-agenda.js';

const { t } = useI18n();
const rota = useRoute();
const tipo = computed(() => String(rota.params['tipo'] ?? 'consulta'));
const id = computed(() => String(rota.params['id'] ?? ''));
const dados = ref<PreCheckinDoPortal | null>(null);
const erro = ref<unknown>(null);
const aviso = ref<string | null>(null);
const proposto = ref<Record<CampoPreCheckin, string>>(
  Object.fromEntries(CAMPOS_PRECHECKIN.map((c) => [c, ''])) as Record<CampoPreCheckin, string>,
);
const arquivos = ref<Partial<Record<TipoDocumentoPreCheckin, string>>>({});
const carteirinha = ref('');
const validade = ref('');
const termo = ref(false);
const tamanhos: Record<CampoPreCheckin, number> = {
  celular: 15,
  telefone: 15,
  email: 50,
  cep: 9,
  logradouro: 40,
  numero: 6,
  complemento: 15,
  bairro: 30,
  contatoNome: 40,
  contatoTelefone: 15,
};

async function carregar(): Promise<void> {
  erro.value = null;
  try {
    dados.value = await preCheckinPortal(tipo.value, id.value);
    for (const c of CAMPOS_PRECHECKIN) {
      const v = dados.value.proposto[c];
      proposto.value[c] = v === undefined ? '' : String(v);
    }
    carteirinha.value = dados.value.carteirinha?.numero ?? '';
    validade.value = dados.value.carteirinha?.validade ?? '';
  } catch (x) {
    erro.value = x;
  }
}

async function escolherArquivo(t2: TipoDocumentoPreCheckin, ev: Event): Promise<void> {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  erro.value = null;
  try {
    const a = await arquivoParaEnvio(f);
    arquivos.value = { ...arquivos.value, [t2]: (await enviarArquivoPreCheckin(a.tipo, a.conteudo)).arquivo };
  } catch (x) {
    erro.value = x;
  }
}

const aberto = computed(() => dados.value?.agendamento.precheckin.pode ?? false);

async function enviar(): Promise<void> {
  erro.value = null;
  aviso.value = null;
  if (!termo.value) {
    aviso.value = t('portal.precheckin.obrigatorioTermo');
    return;
  }
  const d: Record<string, string | number> = {};
  for (const c of CAMPOS_PRECHECKIN) {
    const v = proposto.value[c].trim();
    if (!v) continue;
    d[c] = c === 'numero' ? Number(v.replace(/\D/g, '')) : v;
  }
  try {
    dados.value = await enviarPreCheckinPortal(tipo.value, id.value, {
      dados: d,
      documentos: Object.entries(arquivos.value).map(([tp, arquivo]) => ({ tipo: tp, arquivo })),
      carteirinha: carteirinha.value.trim()
        ? { numero: carteirinha.value.trim(), validade: validade.value || null }
        : null,
      termo: VERSAO_TERMO_PRECHECKIN,
    });
    arquivos.value = {};
    aviso.value = t('portal.precheckin.enviado');
  } catch (x) {
    erro.value = x;
  }
}
const dia = (d: string) => d.split('-').reverse().join('/');
// A hora chega como HH:MM (contrato neutro); lerHoraDigitada também aceita a forma de quatro dígitos e nunca quebra a tela.
const hora = (h: string) => {
  try {
    return lerHoraDigitada(h) ?? '';
  } catch {
    return h;
  }
};
</script>

<template>
  <PortalCasca :titulo="t('portal.precheckin.titulo')" @sessao="carregar" @trocou="carregar">
    <p>{{ t('portal.precheckin.ajuda') }}</p>
    <ErroPortal v-if="erro" :erro="erro" />
    <template v-if="dados">
      <p data-testid="pac-pre-agendamento">
        {{ dia(dados.agendamento.data) }} {{ hora(dados.agendamento.hora) }} ·
        {{ dados.agendamento.procedimento }}
        <span v-if="dados.agendamento.profissional"> · {{ dados.agendamento.profissional }}</span>
      </p>
      <SanteAlerta
        v-if="dados.situacao === 'enviado'"
        :texto="t('portal.precheckin.enviado')"
        variante="info"
        data-testid="pac-pre-situacao"
      />
      <SanteAlerta
        v-else-if="dados.situacao === 'conferido'"
        :texto="t('portal.precheckin.conferido')"
        variante="info"
        data-testid="pac-pre-situacao"
      />
      <SanteAlerta
        v-else-if="dados.situacao === 'recusado'"
        :texto="t('portal.precheckin.recusado', { motivo: dados.motivoRecusa ?? '' })"
        variante="aviso"
        data-testid="pac-pre-situacao"
      />
      <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="pac-pre-aviso" />
      <p v-if="!aberto && dados.situacao !== 'conferido'">{{ t('portal.precheckin.fechado') }}</p>
      <form v-if="aberto" class="portal-painel" data-testid="pac-pre-form" @submit.prevent="enviar">
        <table class="portal-tabela">
          <caption>
            {{
              t('portal.precheckin.titulo')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('portal.precheckin.atual') }}</th>
              <th scope="col">{{ t('portal.precheckin.novo') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in CAMPOS_PRECHECKIN" :key="c">
              <td>
                <strong>{{ t(`portal.precheckin.campos.${c}`) }}</strong
                ><br />{{ dados.atual[c] ?? '—' }}
              </td>
              <td>
                <SanteCampoTexto
                  v-model="proposto[c]"
                  :rotulo="t(`portal.precheckin.campos.${c}`)"
                  :max-bytes="tamanhos[c]"
                  :data-testid="`pac-pre-${c}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <fieldset class="pac-docs">
          <legend>{{ t('portal.precheckin.documentos') }}</legend>
          <span v-for="d in TIPOS_DOCUMENTO_PRECHECKIN" :key="d" class="portal-campo">
            <label :for="`pac-doc-${d}`">{{ t(`portal.precheckin.documento.${d}`) }}</label>
            <input
              :id="`pac-doc-${d}`"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              :data-testid="`pac-doc-${d}`"
              @change="escolherArquivo(d, $event)"
            />
            <span v-if="arquivos[d]" class="portal-secundario">{{
              t('portal.precheckin.arquivoPronto')
            }}</span>
          </span>
        </fieldset>
        <template v-if="dados.pedeCarteirinha">
          <SanteCampoTexto
            v-model="carteirinha"
            :rotulo="t('portal.precheckin.carteirinha')"
            :max-bytes="30"
            data-testid="pac-pre-carteirinha"
          />
          <span class="portal-campo">
            <label for="pac-pre-validade">{{ t('portal.precheckin.validadeCarteirinha') }}</label>
            <input id="pac-pre-validade" v-model="validade" type="date" data-testid="pac-pre-validade" />
          </span>
        </template>
        <label class="pac-termo"
          ><input v-model="termo" type="checkbox" data-testid="pac-pre-termo" />
          {{ t('portal.precheckin.termo', { versao: VERSAO_TERMO_PRECHECKIN }) }}</label
        >
        <SanteBotao
          tipo="submit"
          :rotulo="t('portal.precheckin.enviar')"
          data-testid="pac-pre-enviar"
          @acionar="enviar"
        />
      </form>
    </template>
    <p v-else-if="!erro" role="status">{{ t('portal.carregando') }}</p>
  </PortalCasca>
</template>

<style scoped>
.pac-docs {
  display: flex;
  flex-direction: column;
  gap: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-borda);
  border-radius: 6px;
  padding: var(--sgh-espaco-2) var(--sgh-espaco-3);
}
.pac-termo {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: flex-start;
}
</style>
