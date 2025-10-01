// === IMPORTAÇÕES ===
import qrcode from 'qrcode-terminal';
import puppeteer from 'puppeteer';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import { GoogleSpreadsheet } from 'google-spreadsheet';
import moment from 'moment';
import dotenv from 'dotenv';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

// === CONFIGURAÇÕES ===
dotenv.config();

// Carrega credenciais do arquivo JSON
const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));

// GEMINI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function chamarGemini(pergunta) {
  try {
    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: pergunta }] }]
    });

    if (response?.response?.candidates?.length > 0) {
      const textoResposta = response.response.candidates[0].content.parts[0].text;
      return textoResposta || "🤖 Não consegui entender sua pergunta, tente de outra forma.";
    } else {
      return "🤖 Estou com dificuldades para responder no momento.";
    }
  } catch (err) {
    console.error("Erro ao chamar Gemini:", err);
    return "🤖 Ocorreu um erro ao processar sua mensagem, tente novamente em instantes.";
  }
}

// PLANILHA
const SPREADSHEET_ID = '1B4mLr9qyRna8FheWAtMbfDgidcHnB6W7ati3SHJuXiI';
const doc = new GoogleSpreadsheet(SPREADSHEET_ID);

// --- FERIADOS ---
const FERIADOS = [
  '01/01','21/04','01/05','07/09','12/10','02/11','15/11','25/12'
];

// HORÁRIOS
const HORA_INICIO = "07:30";
const HORA_FIM = "16:30";
const ALMOCO_INICIO = "11:00";
const ALMOCO_FIM = "12:00";

// CONTATOS
const contatos = {
  cotacao: 'José Fernandes - (27) 99978-5768',
  compra: 'Diogo - (27) 99858-1383',
  financeiro: 'Angelita - (27) 99747-4410',
  rh: 'RH - (27) 99784-1052',
  qualidade: 'Gean - (27) 98108-1371'
};

// CLIENTE WHATSAPP
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'bot-kaffee' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// QR CODE
client.on('qr', qr => qrcode.generate(qr, { small: true }));

client.on('ready', async () => {
  console.log('🤖 Bot pronto!');
  await iniciarPlanilha();
});

async function iniciarPlanilha() {
  await doc.useServiceAccountAuth({
    client_email: credentials.client_email,
    private_key: credentials.private_key.replace(/\\n/g, '\n')
  });
  await doc.loadInfo();

  let agendaSheet = doc.sheetsByTitle['Agenda'];

  if (!agendaSheet) {
    const headers = ['CONFIRMAÇÃO','ORDEM','DATA','HORA','VENDEDOR','DESCRIÇÃO','TIPO','CORRETOR','TELEFONE','NOME','QUANTIDADE','EMBALAGEM','MOTIVO'];
    await doc.addSheet({ title: 'Agenda', headerValues: headers });
  } else {
    await agendaSheet.loadHeaderRow();

    const desiredHeaders = ['CONFIRMAÇÃO','ORDEM','DATA','HORA','VENDEDOR','DESCRIÇÃO','TIPO','CORRETOR','TELEFONE','NOME','QUANTIDADE','EMBALAGEM','MOTIVO'];
    const current = agendaSheet.headerValues || [];

    let needsSet = false;
    for (let i = 0; i < desiredHeaders.length; i++) {
      if (current[i] !== desiredHeaders[i]) {
        needsSet = true;
        break;
      }
    }

    if (needsSet) {
      await agendaSheet.setHeaderRow(desiredHeaders);
    }
  }
}

// --- FUNÇÕES AUXILIARES ---

function formatarTelefone(raw) { 
  const tel = raw.replace(/\D/g,'').slice(-11); 
  if (tel.length < 11) return raw; 
  return `(${tel.slice(0,2)}) ${tel.slice(2,7)}-${tel.slice(7)}`; 
} 

function menuPrincipal(nome) { 
  return `👋 Olá ${nome}, seja bem-vindo à *Kaffee Exp. e Imp. Ltda*\n\nEscolha uma opção:\n\n`+
    `1️⃣ Agendamento de descarga\n`+
    `2️⃣ Cotação do café\n`+
    `3️⃣ Comercial\n`+
    `4️⃣ Financeiro\n`+
    `5️⃣ RH\n`+
    `6️⃣ Setor de Qualidade\n`+
    `7️⃣ Falar com atendente\n`+
    `8️⃣ Voltar ao menu\n`+
    `9️⃣ Agendar Manutenção (apenas para Administradores)\n\nDigite o número correspondente.`; 
} 

// --- GERA DATAS (sem sábado/domingo/feriado) --- 
function gerarDatasValidas() { 
  const agora = moment(); 
  let base = agora; 
  if (agora.hour() >= 16 && agora.minute() >= 30) base = agora.add(1, 'days'); 

  const dias = []; 
  let contador = 0; 

  while (dias.length < 7 && contador < 15) { 
    const data = base.clone().add(contador, 'days'); 
    const formato = data.format('DD/MM/YYYY'); 
    const ehFimDeSemana = [6,0].includes(data.day()); 
    const ehFeriado = FERIADOS.includes(data.format('DD/MM')); 

    if (!ehFimDeSemana && !ehFeriado) { 
      dias.push(formato); 
    } 
    contador++; 
  } 
  return dias; 
} 

// --- CALCULA DURAÇÃO BASEADA NA QUANTIDADE --- 
function tempoDescarga(qtdSacas) { 
  if (qtdSacas <= 250) return 45; 
  if (qtdSacas <= 500) return 60; 
  return 120; 
} 

// --- BUSCA HORÁRIOS INDISPONÍVEIS (Agenda: DATA & HORA) --- 
async function getHorariosIndisponiveisParaData(data, doc) { 
  const agendaSheet = doc.sheetsByTitle['Agenda']; 
  const rows = (await agendaSheet.getRows()) || []; 
  return rows 
    .filter(r => String((r['DATA']||'')).trim() === String((data||'')).trim()) 
    .map(r => String(r['HORA']||'').trim()) 
    .filter(x => x); 
} 

// --- GERA HORÁRIOS DINÂMICOS (considera ocupados, bloqueios e horários passados) ---
async function gerarHorariosDisponiveis(data, doc, qtdSacas) {
  const ocupadosArr = await getHorariosIndisponiveisParaData(data, doc);
  const ocupadosSet = new Set(ocupadosArr);

  let horarios = [];
  let horaAtual = moment(HORA_INICIO, "HH:mm");

  const hoje = moment().format('DD/MM/YYYY');
  const isHoje = data === hoje; // verifica se é hoje

  while (horaAtual.isSameOrBefore(moment(HORA_FIM, "HH:mm"))) {
    if (horaAtual.isBetween(moment(ALMOCO_INICIO,"HH:mm"), moment(ALMOCO_FIM,"HH:mm"), null, '[)')) {
      horaAtual = moment(ALMOCO_FIM,"HH:mm");
      continue;
    }

    const horaStr = horaAtual.format("HH:mm");

    if (!ocupadosSet.has(horaStr)) {
      const inicio = horaAtual.clone();
      const fimPrevisto = inicio.clone().add(tempoDescarga(qtdSacas), "minutes");
      const cruzaAlmoco = inicio.isBefore(moment(ALMOCO_INICIO,"HH:mm")) && fimPrevisto.isAfter(moment(ALMOCO_INICIO,"HH:mm"));

      if (!cruzaAlmoco && (!isHoje || inicio.isAfter(moment()))) {
        horarios.push(horaStr);
      }
    }

    horaAtual.add(45, "minutes");
  }

  return horarios.filter(hora=>{
    const inicio = moment(hora,"HH:mm");
    const fim = inicio.clone().add(tempoDescarga(qtdSacas),"minutes");
    return fim.isSameOrBefore(moment(HORA_FIM,"HH:mm"));
  });
}

// --- CONTROLE DE ESTADOS POR USUÁRIO ---
const estados = {}; 

// --- FUNÇÃO: Adicionar agendamento normal ---
async function adicionarAgendamentoNoTopo({ ordem, data, hora, registro, telefone, nome, qtd, embalagem }) { 
  const agendaSheet = doc.sheetsByTitle['Agenda']; 
  const registrosSheet = doc.sheetsByTitle['Registros']; 

  await registrosSheet.loadCells(); 
  const rowsReg = await registrosSheet.getRows(); 
  const encontrado = rowsReg.find(r => String(r['ORDEM']).trim() === String(ordem).trim()); 
  const confirmacao = encontrado ? (encontrado['CONFIRMAÇÃO'] || '') : ''; 

  const novaLinha = { 
    'CONFIRMAÇÃO': confirmacao || '', 
    'ORDEM': ordem || '', 
    'DATA': data || '', 
    'HORA': hora || '', 
    'VENDEDOR': registro['VENDEDOR']||'', 
    'DESCRIÇÃO': registro['DESCRIÇÃO']||'', 
    'TIPO': registro['TIPO']||'', 
    'CORRETOR': registro['CORRETOR']||'', 
    'TELEFONE': telefone || '', 
    'NOME': nome || '', 
    'QUANTIDADE': qtd || '', 
    'EMBALAGEM': embalagem || '', 
    'MOTIVO': '' 
  }; 

  await agendaSheet.addRow(novaLinha, { raw: true, insert: true }); 
} 

// --- FUNÇÃO: Registrar bloqueio(s) na Agenda ---
async function registrarBloqueiosNaAgenda({ data, horarios, motivo, nomeAdmin, telefoneAdmin }) { 
  const agendaSheet = doc.sheetsByTitle['Agenda']; 

  for (const hora of horarios) { 
    const novaLinha = { 
      'CONFIRMAÇÃO': '', 
      'ORDEM': '', 
      'DATA': data, 
      'HORA': hora, 
      'VENDEDOR': '', 
      'DESCRIÇÃO': '', 
      'TIPO': '', 
      'CORRETOR': '', 
      'TELEFONE': telefoneAdmin || '', 
      'NOME': nomeAdmin || '', 
      'QUANTIDADE': '', 
      'EMBALAGEM': '', 
      'MOTIVO': motivo || '' 
    }; 
    await agendaSheet.addRow(novaLinha, { raw: true, insert: true }); 
  } 
} 

client.on('message', async (msg) => {
  try {
    const textoBruto = msg.body || '';
    const texto = textoBruto.toLowerCase().trim();
    const nome = msg._data?.notifyName || 'usuário';
    const telefone = formatarTelefone(msg.from);
    const from = msg.from;

    // Garante estado inicial para novos usuários
    if (!estados[from]) estados[from] = { etapa: null };

    // Gatilhos que sempre retornam ao menu principal
    const gatilhos = ['oi','olá','ola','bom dia','boa tarde','boa noite','menu','agendar','agenda','descarga','chat'];
    if (gatilhos.some(p => texto.includes(p))) {
      estados[from].etapa = null;
      return msg.reply(menuPrincipal(nome));
    }

    // Se não há etapa ativa, trata o menu principal (1..9) ou delega à IA
    if (!estados[from].etapa) {
      switch (textoBruto.trim()) {
        case '1':
          estados[from].etapa = 'ordem';
          return msg.reply('📦 Por favor, envie o número da *ORDEM* de compra.');
        case '2':
          return msg.reply(`📞 Contato: ${contatos.cotacao}`);
        case '3':
          return msg.reply(`📞 Contato: ${contatos.compra}`);
        case '4':
          return msg.reply(`📞 Contato: ${contatos.financeiro}`);
        case '5':
          return msg.reply(`📞 Contato: ${contatos.rh}`);
        case '6':
          return msg.reply(`📞 Contato: ${contatos.qualidade}`);
        case '7':
          return msg.reply('👤 Encaminhando para atendente...');
        case '8':
          return msg.reply(menuPrincipal(nome));
        case '9':
          estados[from].etapa = 'adminSenha';
          return msg.reply('🔐 Digite a senha de administrador:');
        default:
          // Se não for número do menu, delega para a IA (Gemini)
          const respostaIA = await chamarGemini(textoBruto);
          return msg.reply(respostaIA);
      }
    }

    // --- Se chegamos aqui, há uma etapa ativa: processa o fluxo correspondente ---
    const etapaAtual = estados[from].etapa;

    switch (etapaAtual) {
      // ---------------- AGENDAMENTO NORMAL ----------------
      case 'ordem': {
        const numero = msg.body.trim();
        const sheet = doc.sheetsByTitle['Registros'];
        const rows = await sheet.getRows();
        const registro = rows.find(r => String(r['ORDEM']).trim() === numero);

        if (!registro) {
          estados[from].etapa = null;
          return msg.reply('❌ ORDEM não encontrada.');
        }

        const agendaSheet = doc.sheetsByTitle['Agenda'];
        const jaAgendado = (await agendaSheet.getRows()).find(r => String(r['ORDEM']).trim() === numero);
        if (jaAgendado) {
          estados[from].etapa = null;
          return msg.reply("❌ Esta ORDEM de descarga já foi agendada. Entre em contato caso deseje alterar data ou horário.");
        }

        estados[from].ordem = numero;
        estados[from].registro = registro;

        const dias = gerarDatasValidas();
        const opcoesDatas = dias.map((d,i)=>`${i+1}️⃣ ${d}`).join('\n');
        estados[from].etapa = 'data';
        return msg.reply(`📋 Escolha a data do agendamento:\n\n${opcoesDatas}`);
      }

      case 'data': {
        const dias = gerarDatasValidas();
        const indiceData = parseInt(texto) - 1;
        const dataEscolhida = dias[indiceData];
        if (!dataEscolhida) {
          estados[from].etapa = null;
          return msg.reply('❌ Opção inválida. Agendamento cancelado.');
        }

        estados[from].data = dataEscolhida;
        estados[from].etapa = 'embalagem';
        return msg.reply("📦 Qual a forma de descarga?\n\n1️⃣ Granel\n2️⃣ Sacaria\n3️⃣ Bags");
      }

      case 'embalagem': {
        let embalagem = '';
        if (texto === '1') embalagem = 'Granel';
        else if (texto === '2') embalagem = 'Sacaria';
        else if (texto === '3') embalagem = 'Bags';
        else {
          return msg.reply("❌ Opção inválida. Digite 1, 2 ou 3.");
        }

        estados[from].embalagem = embalagem;
        estados[from].etapa = 'quantidade';
        return msg.reply("📊 Informe a quantidade total de sacas:");
      }

      case 'quantidade': {
        const qtdSacas = parseInt(msg.body.trim());
        if (isNaN(qtdSacas) || qtdSacas <= 0) {
          return msg.reply("❌ Quantidade inválida. Digite apenas números.");
        }

        estados[from].qtd = qtdSacas;
        estados[from].etapa = 'periodo';
        return msg.reply("🌞 Escolha o período:\n\n1️⃣ Manhã\n2️⃣ Tarde");
      }

      case 'periodo': {
        let periodo = '';
        if (texto === '1') periodo = 'manhã';
        else if (texto === '2') periodo = 'tarde';
        else return msg.reply("❌ Opção inválida. Digite 1 ou 2.");

        estados[from].periodo = periodo;

        let horariosDisponiveis = await gerarHorariosDisponiveis(estados[from].data, doc, estados[from].qtd);

        // Filtrar horários passados se a data for hoje
        const agora = moment();
        if (moment(estados[from].data, "DD/MM/YYYY").isSame(agora, 'day')) {
          horariosDisponiveis = horariosDisponiveis.filter(h => moment(h, "HH:mm").isAfter(agora));
        }

        // Filtra pelo período (manhã / tarde)
        if (periodo === 'manhã') {
          horariosDisponiveis = horariosDisponiveis.filter(h => moment(h,'HH:mm').isBefore(moment(ALMOCO_INICIO,'HH:mm')));
        } else {
          horariosDisponiveis = horariosDisponiveis.filter(h => moment(h,'HH:mm').isSameOrAfter(moment(ALMOCO_FIM,'HH:mm')));
        }

        if (horariosDisponiveis.length === 0) {
          estados[from].etapa = null;
          return msg.reply("⚠️ Nenhum horário disponível nesse período.");
        }

        const opcoes = horariosDisponiveis.map((h,i)=>`${i+1}️⃣ ${h}`).join('\n');
        estados[from].horarios = horariosDisponiveis;
        estados[from].etapa = 'hora';
        return msg.reply(`⏰ Escolha o horário desejado:\n\n${opcoes}`);
      }

      case 'hora': {
        const indiceHora = parseInt(texto) - 1;
        const horaEscolhida = estados[from].horarios && estados[from].horarios[indiceHora];
        if (!horaEscolhida) {
          estados[from].etapa = null;
          return msg.reply("❌ Opção inválida. Agendamento cancelado.");
        }

        await adicionarAgendamentoNoTopo({
          ordem: estados[from].ordem,
          data: estados[from].data,
          hora: horaEscolhida,
          registro: estados[from].registro,
          telefone,
          nome,
          qtd: estados[from].qtd,
          embalagem: estados[from].embalagem
        });

        await msg.reply(
          `✅ Agendamento realizado com sucesso!\n\n📄 *Resumo:*\n`+
          `• Ordem: ${estados[from].ordem}\n`+
          `• Data: ${estados[from].data}\n`+
          `• Horário: ${horaEscolhida}\n`+
          `• Quantidade: ${estados[from].qtd} sacas\n`+
          `• Embalagem: ${estados[from].embalagem}\n`+
          `• Vendedor: ${estados[from].registro['VENDEDOR'] || 'Não informado'}`
        );

        estados[from] = { etapa: null };
        return;
      }

      // ---------------- ADMIN: AGENDAR MANUTENÇÃO (OPÇÃO 9) ----------------
      case 'adminSenha': {
        try {
          const dadosSheet = doc.sheetsByTitle['Dados'];
          if (!dadosSheet) {
            return msg.reply('❌ Aba "Dados" não encontrada. Contate o administrador.');
          }

          await dadosSheet.loadCells('E1');
          const cell = dadosSheet.getCell(0,4); // E1
          const senhaCorreta = (cell.value || '').toString().trim();

          if (!senhaCorreta) {
            return msg.reply('❌ Senha não cadastrada na planilha. Contate o administrador.');
          }

          if (textoBruto.trim() === senhaCorreta) {
            estados[from].etapa = 'adminData';
            return msg.reply('✅ Senha correta.\n\n📅 Digite a data do bloqueio (formato DD/MM/YYYY):');
          } else {
            // mantém o estado em 'adminSenha' para permitir nova tentativa
            return msg.reply('❌ Senha incorreta. Tente novamente ou digite "menu" para voltar.');
          }
        } catch (err) {
          console.error('Erro ao verificar senha admin:', err);
          return msg.reply('❌ Ocorreu um erro ao validar a senha. Tente novamente mais tarde.');
        }
      }

      case 'adminData': {
        if (!moment(textoBruto, "DD/MM/YYYY", true).isValid()) {
          return msg.reply("⚠️ Data inválida! Use o formato DD/MM/YYYY.");
        }

        estados[from].adminData = moment(textoBruto, "DD/MM/YYYY").format('DD/MM/YYYY');

        // Gerar horários disponíveis para a data (usamos qtd padrão 250 para slots de 45min)
        const horariosDisponiveis = await gerarHorariosDisponiveis(estados[from].adminData, doc, 250);

        if (!horariosDisponiveis || horariosDisponiveis.length === 0) {
          estados[from].etapa = null;
          return msg.reply('⚠️ Não há horários disponíveis para bloqueio nesta data.');
        }

        const opcoes = horariosDisponiveis.map((h,i)=>`${i+1}️⃣ ${h}`).join('\n');
        estados[from].adminHorariosList = horariosDisponiveis;
        estados[from].etapa = 'adminEscolherHorarios';

        return msg.reply(`⏰ Escolha os horários a bloquear. Você pode selecionar múltiplos escrevendo os números separados por vírgula.\n\n${opcoes}\n\nExemplo: 1,2,3`);
      }

      case 'adminEscolherHorarios': {
        const parts = textoBruto.split(',').map(p=>p.trim()).filter(p=>p);
        const indices = [];
        for (const p of parts) {
          const n = parseInt(p);
          if (!isNaN(n) && n >= 1 && n <= (estados[from].adminHorariosList||[]).length) {
            indices.push(n-1);
          }
        }

        if (indices.length === 0) {
          return msg.reply('❌ Nenhuma opção válida selecionada. Digite novamente os números dos horários ou "menu" para cancelar.');
        }

        const selecionados = [...new Set(indices)].map(i => estados[from].adminHorariosList[i]);
        estados[from].adminHorariosSelecionados = selecionados;
        estados[from].etapa = 'adminMotivo';

        return msg.reply('✏️ Agora digite o motivo do bloqueio (texto livre):');
      }

      case 'adminMotivo': {
        const motivo = textoBruto.trim();
        if (!motivo) {
          return msg.reply('❌ Motivo não pode ser vazio. Digite o motivo do bloqueio:');
        }

        const data = estados[from].adminData;
        const horarios = estados[from].adminHorariosSelecionados || [];
        const nomeAdmin = msg._data?.notifyName || 'Administrador';
        const telefoneAdmin = formatarTelefone(msg.from);

        // Registra cada bloqueio na aba 'Agenda' (cada horário uma linha)
        await registrarBloqueiosNaAgenda({ data, horarios, motivo, nomeAdmin, telefoneAdmin });

        // Resetar estado
        estados[from] = { etapa: null };

        return msg.reply(
          `✅ Bloqueio(s) registrado(s) com sucesso!\n\n` +
          `📅 Data: ${data}\n` +
          `⏰ Horários: ${horarios.join(', ')}\n` +
          `📝 Motivo: ${motivo}`
        );
      }

      // ---------------- CASO NÃO MAPEADO: volta ao menu para segurança ----------------
      default: {
        estados[from].etapa = null;
        return msg.reply(menuPrincipal(nome));
      }
    }

  } catch (err) {
    console.error('Erro no fluxo de mensagens:', err);
    try { await msg.reply('❌ Ocorreu um erro interno. Tente novamente mais tarde.'); } catch(e){}
  }
});

    
  
client.initialize();
