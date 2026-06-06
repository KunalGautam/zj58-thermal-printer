const { driver } = require('./driver');

/**
 * Manages sequential printing queues, ensuring only one write command is sent to the printer at a time.
 */
class QueueManager {
  constructor() {
    this.jobs = [];
    this.active = false;
    this.history = [];
    this.jobCounter = 1;
  }

  /**
   * Enqueue a job for printing
   * @param {Buffer} data - Binary ESC/POS bytes to print
   * @param {Object} options - { type, description, maxRetries }
   * @returns {string} - Unique job ID
   */
  enqueue(data, options = {}) {
    const jobId = `job_${this.jobCounter++}_${Date.now()}`;
    const job = {
      id: jobId,
      status: 'queued',
      type: options.type || 'unknown',
      description: options.description || 'Raw Print Job',
      data, // Holds the actual raw bytes
      options,
      retries: 0,
      maxRetries: options.maxRetries !== undefined ? Number(options.maxRetries) : 2,
      error: null,
      timestamp: new Date().toISOString(),
      duration: 0
    };

    this.jobs.push(job);

    // Save job status without storing the huge binary data block in history memory
    const historyItem = { ...job };
    delete historyItem.data;
    this.history.push(historyItem);
    
    if (this.history.length > 50) {
      this.history.shift();
    }

    console.log(`[Queue] Job ${jobId} enqueued: "${job.description}"`);
    
    // Trigger queue processing asynchronously
    setImmediate(() => this._process());

    return jobId;
  }

  /**
   * Retrieves log details for a job
   */
  getJob(id) {
    return this.history.find(j => j.id === id);
  }

  /**
   * Retrieves the current list of job logs
   */
  getHistory() {
    return this.history;
  }

  /**
   * Processes the queue sequentially
   */
  async _process() {
    if (this.active || this.jobs.length === 0) return;
    this.active = true;

    const job = this.jobs.shift();
    const historyJob = this.history.find(j => j.id === job.id);
    
    if (historyJob) {
      historyJob.status = 'printing';
    }

    console.log(`[Queue] Started printing job ${job.id}: "${job.description}"`);
    const startTime = Date.now();

    while (job.retries <= job.maxRetries) {
      try {
        if (!driver.isConnected) {
          throw new Error('Printer is disconnected. Connect to a printer first.');
        }

        // Transfer bytes directly to printer OUT endpoint
        await driver.write(job.data);
        
        // Handle success
        if (historyJob) {
          historyJob.status = 'completed';
          historyJob.duration = Date.now() - startTime;
        }
        console.log(`[Queue] Job ${job.id} completed successfully in ${Date.now() - startTime}ms.`);
        break;

      } catch (err) {
        job.retries++;
        console.error(`[Queue] Job ${job.id} failed (Attempt ${job.retries}/${job.maxRetries + 1}): ${err.message}`);
        
        if (job.retries > job.maxRetries) {
          // Permanently failed
          if (historyJob) {
            historyJob.status = 'failed';
            historyJob.error = err.message;
            historyJob.duration = Date.now() - startTime;
          }
          console.error(`[Queue] Job ${job.id} permanently failed after ${job.retries} attempts.`);
        } else {
          // Wait 1 second before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    this.active = false;
    
    // Trigger processing of the next job in the queue
    setImmediate(() => this._process());
  }
}

const queueInstance = new QueueManager();

module.exports = queueInstance;
